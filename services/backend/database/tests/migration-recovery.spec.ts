import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RECOVERABLE_MIGRATION,
  recoverFailedMigration,
  type ActiveFailedMigration,
  type MigrationCommandRunner,
  type MigrationRecoveryStore,
} from '../src/migration-recovery.js';

const expectedFailure: ActiveFailedMigration = {
  migrationName: RECOVERABLE_MIGRATION,
  logs: 'Database error code: 55P04\nunsafe use of new value "CONNECTED"',
};

test('resolve a falha conhecida antes de executar migrate deploy', async () => {
  const calls: string[] = [];
  const result = await recoverFailedMigration(
    createStore([[expectedFailure], []]),
    createRunner(calls),
  );

  assert.deepEqual(calls, [`resolve:${RECOVERABLE_MIGRATION}`, 'deploy']);
  assert.deepEqual(result, { deployExecuted: true, migrationResolved: true });
});

test('é idempotente quando não existe migration failed', async () => {
  const calls: string[] = [];
  const result = await recoverFailedMigration(createStore([[]]), createRunner(calls));

  assert.deepEqual(calls, ['deploy']);
  assert.deepEqual(result, { deployExecuted: true, migrationResolved: false });
});

test('recusa resolver automaticamente uma migration desconhecida', async () => {
  const calls: string[] = [];

  await assert.rejects(
    recoverFailedMigration(
      createStore([
        [
          {
            migrationName: '20990101000000_unknown_failure',
            logs: 'Database error code: 55P04',
          },
        ],
      ]),
      createRunner(calls),
    ),
    /migrations não autorizadas/,
  );
  assert.deepEqual(calls, []);
});

test('recusa a Beta-12B quando a causa não é a falha de enum auditada', async () => {
  const calls: string[] = [];

  await assert.rejects(
    recoverFailedMigration(
      createStore([[{ migrationName: RECOVERABLE_MIGRATION, logs: 'duplicate column' }]]),
      createRunner(calls),
    ),
    /causa diferente da causa auditada/,
  );
  assert.deepEqual(calls, []);
});

test('continua com deploy quando outra execução concorrente já resolveu a falha', async () => {
  const calls: string[] = [];
  const runner = createRunner(calls, true);
  const result = await recoverFailedMigration(createStore([[expectedFailure], []]), runner);

  assert.deepEqual(calls, [`resolve:${RECOVERABLE_MIGRATION}`, 'deploy']);
  assert.deepEqual(result, { deployExecuted: true, migrationResolved: false });
});

test('não executa deploy se a migration continuar failed após o resolve', async () => {
  const calls: string[] = [];

  await assert.rejects(
    recoverFailedMigration(
      createStore([[expectedFailure], [expectedFailure]]),
      createRunner(calls),
    ),
    /continuam marcadas como failed/,
  );
  assert.deepEqual(calls, [`resolve:${RECOVERABLE_MIGRATION}`]);
});

function createStore(
  results: readonly (readonly ActiveFailedMigration[])[],
): MigrationRecoveryStore {
  let index = 0;
  return {
    listActiveFailedMigrations: async () => {
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result ?? [];
    },
  };
}

function createRunner(calls: string[], failResolve = false): MigrationCommandRunner {
  return {
    deploy: async () => {
      calls.push('deploy');
    },
    resolveRolledBack: async (migrationName) => {
      calls.push(`resolve:${migrationName}`);
      if (failResolve) {
        throw new Error('already resolved');
      }
    },
  };
}
