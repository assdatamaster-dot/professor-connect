import { readdir } from 'node:fs/promises';

import type { PrismaClient } from '@prisma/client';

interface AppliedMigration {
  finishedAt: Date | null;
  migrationName: string;
  rolledBackAt: Date | null;
}

interface MigrationTableState {
  exists: boolean;
}

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);

/**
 * Refuses to let application startup touch domain tables unless every migration
 * shipped with the current release was applied successfully.
 */
export async function assertMigrationsApplied(prisma: PrismaClient): Promise<void> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const expectedMigrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (expectedMigrations.length === 0) {
    throw new Error('Nenhuma migration Prisma foi incluída no artefato de produção.');
  }

  const [migrationTable] = await prisma.$queryRaw<MigrationTableState[]>`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"
  `;

  if (migrationTable?.exists !== true) {
    throw new Error(
      'Banco não preparado: a tabela _prisma_migrations não existe. Execute prisma migrate deploy antes de iniciar a API.',
    );
  }

  const appliedMigrations = await prisma.$queryRaw<AppliedMigration[]>`
    SELECT
      "migration_name" AS "migrationName",
      "finished_at" AS "finishedAt",
      "rolled_back_at" AS "rolledBackAt"
    FROM "_prisma_migrations"
  `;
  const successfullyApplied = new Set(
    appliedMigrations
      .filter((migration) => migration.finishedAt !== null && migration.rolledBackAt === null)
      .map((migration) => migration.migrationName),
  );
  const pendingMigrations = expectedMigrations.filter(
    (migrationName) => !successfullyApplied.has(migrationName),
  );

  if (pendingMigrations.length > 0) {
    throw new Error(
      `Banco não preparado: migrations pendentes ou malsucedidas: ${pendingMigrations.join(', ')}.`,
    );
  }
}
