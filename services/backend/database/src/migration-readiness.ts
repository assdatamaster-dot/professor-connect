import { readFile, readdir } from 'node:fs/promises';

import type { PrismaClient } from '@prisma/client';

interface AppliedMigration {
  finishedAt: Date | null;
  migrationName: string;
  rolledBackAt: Date | null;
}

interface MigrationTableState {
  exists: boolean;
}

interface DatabaseIdentity {
  databaseName: string;
  schemaName: string;
}

interface DatabaseTable {
  tableName: string;
}

export interface DatabaseReadinessReport {
  readonly databaseName: string;
  readonly schemaName: string;
  readonly migrationCount: number;
  readonly tableCount: number;
}

export interface DatabaseTarget {
  readonly databaseName: string;
  readonly host: string;
  readonly port: string;
  readonly schemaName: string;
}

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
const schemaFile = new URL('../prisma/schema.prisma', import.meta.url);

export function describeDatabaseTarget(value = process.env.DATABASE_URL): DatabaseTarget {
  if (value === undefined || value.trim() === '') {
    throw new Error('DATABASE_URL é obrigatória para iniciar o backend.');
  }
  const target = new URL(value);
  if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
    throw new Error(`DATABASE_URL deve usar PostgreSQL; protocolo recebido: ${target.protocol}`);
  }
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (databaseName === '') {
    throw new Error('DATABASE_URL deve informar explicitamente o nome do banco PostgreSQL.');
  }
  return {
    host: target.hostname,
    port: target.port || '5432',
    databaseName,
    schemaName: target.searchParams.get('schema') || 'public',
  };
}

/**
 * Refuses to let application startup touch domain tables unless every migration
 * shipped with the current release was applied successfully.
 */
export async function assertMigrationsApplied(
  prisma: PrismaClient,
): Promise<DatabaseReadinessReport> {
  const [entries, schema] = await Promise.all([
    readdir(migrationsDirectory, { withFileTypes: true }),
    readFile(schemaFile, 'utf8'),
  ]);
  const expectedMigrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedTables = [...schema.matchAll(/@@map\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .filter((tableName): tableName is string => tableName !== undefined)
    .sort();

  if (expectedMigrations.length === 0) {
    throw new Error('Nenhuma migration Prisma foi incluída no artefato de produção.');
  }
  if (expectedTables.length === 0) {
    throw new Error('Nenhuma tabela foi encontrada no schema Prisma do artefato de produção.');
  }

  const [identity] = await prisma.$queryRaw<DatabaseIdentity[]>`
    SELECT current_database() AS "databaseName", current_schema() AS "schemaName"
  `;
  if (identity === undefined) {
    throw new Error('Não foi possível identificar o banco PostgreSQL conectado.');
  }

  const [migrationTable] = await prisma.$queryRaw<MigrationTableState[]>`
    SELECT to_regclass(quote_ident(current_schema()) || '._prisma_migrations') IS NOT NULL AS "exists"
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

  const databaseTables = await prisma.$queryRaw<DatabaseTable[]>`
    SELECT tablename AS "tableName"
    FROM pg_catalog.pg_tables
    WHERE schemaname = current_schema()
  `;
  const existingTables = new Set(databaseTables.map((table) => table.tableName));
  const missingTables = expectedTables.filter((tableName) => !existingTables.has(tableName));
  if (missingTables.length > 0) {
    throw new Error(
      `Banco inconsistente: migrations registradas, mas tabelas ausentes: ${missingTables.join(', ')}.`,
    );
  }

  return {
    databaseName: identity.databaseName,
    schemaName: identity.schemaName,
    migrationCount: expectedMigrations.length,
    tableCount: expectedTables.length,
  };
}
