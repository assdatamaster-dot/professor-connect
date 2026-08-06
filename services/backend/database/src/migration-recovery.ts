export const RECOVERABLE_MIGRATION = '20260806150000_beta_12b_session_recovery';

export interface ActiveFailedMigration {
  readonly logs: string | null;
  readonly migrationName: string;
}

export interface MigrationRecoveryStore {
  listActiveFailedMigrations(): Promise<readonly ActiveFailedMigration[]>;
}

export interface MigrationCommandRunner {
  deploy(): Promise<void>;
  resolveRolledBack(migrationName: string): Promise<void>;
}

export interface MigrationRecoveryResult {
  readonly deployExecuted: true;
  readonly migrationResolved: boolean;
}

export type MigrationRecoveryLogger = (
  event: string,
  data?: Readonly<Record<string, boolean | number | string>>,
) => void;

// Add future production recoveries here only after auditing that retrying the
// migration is safe and adding regression coverage for its exact database error.
const recoveryAllowlist = new Map<string, RegExp>([
  [RECOVERABLE_MIGRATION, /(?:55P04|unsafe use of new value\s+["']CONNECTED["'])/i],
]);

function assertFailuresAreRecoverable(failures: readonly ActiveFailedMigration[]): void {
  const unsupported = failures.filter(
    (migration) => !recoveryAllowlist.has(migration.migrationName),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Recuperação automática recusada: migrations não autorizadas estão com falha: ${unsupported
        .map((migration) => migration.migrationName)
        .join(', ')}.`,
    );
  }

  const unexpectedErrors = failures.filter((migration) => {
    const rule = recoveryAllowlist.get(migration.migrationName);
    return rule === undefined || migration.logs === null || !rule.test(migration.logs);
  });
  if (unexpectedErrors.length > 0) {
    throw new Error(
      `Recuperação automática recusada: ${unexpectedErrors
        .map((migration) => migration.migrationName)
        .join(', ')} falhou por uma causa diferente da causa auditada.`,
    );
  }
}

/**
 * Resolves only the audited Beta-12B enum failure. Unknown failures are never
 * marked as rolled back automatically.
 */
export async function recoverFailedMigration(
  store: MigrationRecoveryStore,
  runner: MigrationCommandRunner,
  log: MigrationRecoveryLogger = () => undefined,
): Promise<MigrationRecoveryResult> {
  const initialFailures = await store.listActiveFailedMigrations();

  if (initialFailures.length === 0) {
    log('Nenhuma migration com falha ativa; executando deploy idempotente.');
    await runner.deploy();
    return { deployExecuted: true, migrationResolved: false };
  }

  assertFailuresAreRecoverable(initialFailures);
  const migrationsToResolve = [...new Set(initialFailures.map((failure) => failure.migrationName))];
  const resolveErrors = new Map<string, unknown>();
  for (const migrationName of migrationsToResolve) {
    log('Falha recuperável confirmada.', {
      migration: migrationName,
      occurrences: initialFailures.filter((failure) => failure.migrationName === migrationName)
        .length,
    });
    try {
      await runner.resolveRolledBack(migrationName);
    } catch (error: unknown) {
      resolveErrors.set(migrationName, error);
    }
  }

  const remainingFailures = await store.listActiveFailedMigrations();
  if (remainingFailures.length > 0) {
    assertFailuresAreRecoverable(remainingFailures);
    const firstRemaining = remainingFailures[0];
    const resolveError =
      firstRemaining === undefined ? undefined : resolveErrors.get(firstRemaining.migrationName);
    throw new Error(
      `Migrations continuam marcadas como failed após o resolve: ${remainingFailures
        .map((migration) => migration.migrationName)
        .join(', ')}.`,
      resolveError === undefined ? undefined : { cause: resolveError },
    );
  }

  for (const migrationName of migrationsToResolve) {
    if (resolveErrors.has(migrationName)) {
      log('A migration foi resolvida por outra execução concorrente; continuando com deploy.', {
        migration: migrationName,
      });
    } else {
      log('Migration marcada como rolled back com segurança.', {
        migration: migrationName,
      });
    }
  }

  await runner.deploy();
  return { deployExecuted: true, migrationResolved: resolveErrors.size === 0 };
}
