import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import type { PrismaClient } from '@prisma/client';

import { assertMigrationsApplied } from '../src/migration-readiness.js';

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

test('accepts startup only after every bundled migration is complete', async () => {
  const prisma = createPrismaStub([
    [{ exists: true }],
    MIGRATIONS.map((migrationName) => ({
      migrationName,
      finishedAt: new Date(),
      rolledBackAt: null,
    })),
  ]);

  await assert.doesNotReject(assertMigrationsApplied(prisma));
});

test('rejects startup when the Prisma migration table does not exist', async () => {
  const prisma = createPrismaStub([[{ exists: false }]]);

  await assert.rejects(assertMigrationsApplied(prisma), /a tabela _prisma_migrations não existe/);
});

test('rejects startup when a bundled migration is pending', async () => {
  const prisma = createPrismaStub([
    [{ exists: true }],
    MIGRATIONS.slice(0, -1).map((migrationName) => ({
      migrationName,
      finishedAt: new Date(),
      rolledBackAt: null,
    })),
  ]);

  await assert.rejects(assertMigrationsApplied(prisma), /20260805180000_bootstrap_first_run/);
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

function createPrismaStub(queryResults: unknown[]): PrismaClient {
  let queryIndex = 0;

  return {
    $queryRaw: async () => queryResults[queryIndex++],
  } as unknown as PrismaClient;
}
