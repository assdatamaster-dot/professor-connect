import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { PrismaClient } from '@prisma/client';

import {
  recoverFailedMigration,
  type ActiveFailedMigration,
  type MigrationCommandRunner,
  type MigrationRecoveryStore,
} from './migration-recovery.js';

interface MigrationTableState {
  exists: boolean;
}

const require = createRequire(import.meta.url);
const prismaCliPath = require.resolve('prisma/build/index.js');
const schemaPath = 'prisma/schema.prisma';

class PrismaMigrationStore implements MigrationRecoveryStore {
  public constructor(private readonly prisma: PrismaClient) {}

  public async listActiveFailedMigrations(): Promise<readonly ActiveFailedMigration[]> {
    const [migrationTable] = await this.prisma.$queryRaw<MigrationTableState[]>`
      SELECT to_regclass(quote_ident(current_schema()) || '._prisma_migrations') IS NOT NULL AS "exists"
    `;
    if (migrationTable?.exists !== true) {
      return [];
    }

    return this.prisma.$queryRaw<ActiveFailedMigration[]>`
      SELECT
        "migration_name" AS "migrationName",
        "logs"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL
        AND "rolled_back_at" IS NULL
      ORDER BY "started_at"
    `;
  }
}

class LocalPrismaCommandRunner implements MigrationCommandRunner {
  public deploy(): Promise<void> {
    return runPrisma(['migrate', 'deploy', '--schema', schemaPath]);
  }

  public resolveRolledBack(migrationName: string): Promise<void> {
    return runPrisma([
      'migrate',
      'resolve',
      '--rolled-back',
      migrationName,
      '--schema',
      schemaPath,
    ]);
  }
}

async function runPrisma(arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCliPath, ...arguments_], {
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Prisma terminou sem sucesso (${signal === null ? `exit code ${String(code)}` : `sinal ${signal}`}).`,
        ),
      );
    });
  });
}

function log(event: string, data: Readonly<Record<string, boolean | number | string>> = {}): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      origin: 'migration-recovery',
      event,
      data,
    }),
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await recoverFailedMigration(
      new PrismaMigrationStore(prisma),
      new LocalPrismaCommandRunner(),
      log,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      origin: 'migration-recovery',
      event: 'Recuperação de migration falhou.',
      data: { message },
    }),
  );
  process.exitCode = 1;
});
