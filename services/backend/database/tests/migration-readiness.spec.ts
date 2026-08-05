import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import type { PrismaClient } from '@prisma/client';

import { assertMigrationsApplied, describeDatabaseTarget } from '../src/migration-readiness.js';

const MIGRATIONS = [
  '20260731090000_identity_and_access',
  '20260731091000_support_workflow',
  '20260731091500_protocol_workflow',
  '20260731092000_events_audit_and_transfers',
  '20260803090000_authentication_security',
  '20260804090000_user_registration_and_profiles',
  '20260805090000_administrative_panel',
  '20260805150000_intelligent_attendance_flow',
  '20260805180000_bootstrap_first_run',
] as const;
const TABLES = [
  'organizations',
  'users',
  'system_settings',
  'bootstrap_state',
  'user_avatars',
  'roles',
  'permissions',
  'user_roles',
  'role_permissions',
  'auth_tokens',
  'external_identities',
  'professors',
  'students',
  'presence_connections',
  'session_requests',
  'session_request_recipients',
  'attendance_sessions',
  'workflow_sessions',
  'workflow_session_participants',
  'support_calls',
  'file_transfers',
  'domain_events',
  'audit_logs',
  'application_logs',
] as const;
const IDENTITY = [{ databaseName: 'professorconnect', schemaName: 'public' }] as const;

test('describes the configured database without exposing credentials', () => {
  assert.deepEqual(
    describeDatabaseTarget(
      'postgresql://professor_connect:super-secret@postgres.internal:5433/professorconnect?schema=tenant',
    ),
    {
      host: 'postgres.internal',
      port: '5433',
      databaseName: 'professorconnect',
      schemaName: 'tenant',
    },
  );
  assert.throws(() => describeDatabaseTarget(''), /DATABASE_URL é obrigatória/);
});

test('accepts startup only after every bundled migration is complete', async () => {
  const prisma = createPrismaStub([
    IDENTITY,
    [{ exists: true }],
    MIGRATIONS.map((migrationName) => ({
      migrationName,
      finishedAt: new Date(),
      rolledBackAt: null,
    })),
    TABLES.map((tableName) => ({ tableName })),
  ]);

  assert.deepEqual(await assertMigrationsApplied(prisma), {
    databaseName: 'professorconnect',
    schemaName: 'public',
    migrationCount: MIGRATIONS.length,
    tableCount: TABLES.length,
  });
});

test('rejects startup when the Prisma migration table does not exist', async () => {
  const prisma = createPrismaStub([IDENTITY, [{ exists: false }]]);

  await assert.rejects(assertMigrationsApplied(prisma), /a tabela _prisma_migrations não existe/);
});

test('rejects startup when a bundled migration is pending', async () => {
  const prisma = createPrismaStub([
    IDENTITY,
    [{ exists: true }],
    MIGRATIONS.slice(0, -1).map((migrationName) => ({
      migrationName,
      finishedAt: new Date(),
      rolledBackAt: null,
    })),
  ]);

  await assert.rejects(assertMigrationsApplied(prisma), /20260805180000_bootstrap_first_run/);
});

test('rejects startup when migrations are recorded but a domain table is absent', async () => {
  const prisma = createPrismaStub([
    IDENTITY,
    [{ exists: true }],
    MIGRATIONS.map((migrationName) => ({
      migrationName,
      finishedAt: new Date(),
      rolledBackAt: null,
    })),
    TABLES.filter((tableName) => tableName !== 'users').map((tableName) => ({ tableName })),
  ]);

  await assert.rejects(assertMigrationsApplied(prisma), /tabelas ausentes: users/);
});

test('migration do fluxo inteligente persiste disponibilidade do professor', async () => {
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20260805150000_intelligent_attendance_flow/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(sql, /CREATE TYPE "ProfessorAvailability"/);
  assert.match(sql, /ADD COLUMN "availability"/);
  assert.match(sql, /ADD COLUMN "available_since"/);
  assert.match(sql, /organization_id.*availability.*available_since/);
});

test('migration administrativa preserva histórico e prepara isolamento por instituição', async () => {
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20260805090000_administrative_panel/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(sql, /'ACTIVE', 'INACTIVE', 'BLOCKED'/);
  assert.match(sql, /ADD COLUMN "deleted_at"/);
  assert.match(sql, /users_organization_email_lower_key/);
  assert.match(sql, /CREATE TABLE "user_avatars"/);
  assert.doesNotMatch(sql, /INSERT INTO "users"/i);
});

test('migration de cadastro prepara perfis sem criar usuários artificiais', async () => {
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20260804090000_user_registration_and_profiles/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(sql, /ADD COLUMN "avatar_url"/);
  assert.match(sql, /ADD COLUMN "last_login_at"/);
  assert.match(sql, /CREATE UNIQUE INDEX "users_email_lower_key"/);
  assert.doesNotMatch(sql, /INSERT INTO "users"/i);
});

test('migration de bootstrap cria trava transacional e configurações iniciais', async () => {
  const sql = await readFile(
    new URL(
      '../prisma/migrations/20260805180000_bootstrap_first_run/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(sql, /CREATE TABLE "bootstrap_state"/);
  assert.match(sql, /CREATE TABLE "system_settings"/);
  assert.match(sql, /INSERT INTO "bootstrap_state"/);
  assert.doesNotMatch(sql, /INSERT INTO "users"/i);
  assert.doesNotMatch(sql, /INSERT INTO "organizations"/i);
});

test('seed sincroniza somente referências e preserva o estado de primeiro acesso', async () => {
  const seed = await readFile(new URL('../prisma/seed.ts', import.meta.url), 'utf8');

  assert.match(seed, /transaction\.role\.upsert/);
  assert.match(seed, /transaction\.permission\.upsert/);
  assert.doesNotMatch(seed, /transaction\.organization\.(?:create|upsert)/);
  assert.doesNotMatch(seed, /transaction\.user\.(?:create|upsert)/);
});

test('imagem Docker prepara e valida o banco pelo entrypoint antes do servidor', async () => {
  const [dockerfile, entrypoint, rootPackage] = await Promise.all([
    readFile(new URL('../../Dockerfile', import.meta.url), 'utf8'),
    readFile(new URL('../../docker-entrypoint.sh', import.meta.url), 'utf8'),
    readFile(new URL('../../../../package.json', import.meta.url), 'utf8'),
  ]);

  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/professor-connect-entrypoint"\]/);
  assert.match(dockerfile, /CMD \["node", "services\/backend\/api\/dist\/server\.js"\]/);
  assert.match(entrypoint, /npm run backend:prepare/);
  assert.match(entrypoint, /exec "\$@"/);
  assert.doesNotMatch(entrypoint, /username|password/);
  assert.match(rootPackage, /prisma:generate.*prisma:deploy.*prisma:status/);
});

test('preview administrativo é explicitamente bloqueado em produção', async () => {
  const preview = await readFile(
    new URL('../../api/tests/admin-preview.ts', import.meta.url),
    'utf8',
  );

  assert.match(preview, /process\.env\.NODE_ENV === 'production'/);
  assert.match(preview, /servidor de preview administrativo é proibido em produção/);
});

function createPrismaStub(queryResults: unknown[]): PrismaClient {
  let queryIndex = 0;

  return {
    $queryRaw: async () => queryResults[queryIndex++],
  } as unknown as PrismaClient;
}
