import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PrismaClient } from '@prisma/client';

import { assertMigrationsApplied } from '../src/migration-readiness.js';

const MIGRATIONS = [
  '20260731090000_identity_and_access',
  '20260731091000_support_workflow',
  '20260731091500_protocol_workflow',
  '20260731092000_events_audit_and_transfers',
  '20260803090000_authentication_security',
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

  await assert.rejects(assertMigrationsApplied(prisma), /20260803090000_authentication_security/);
});

function createPrismaStub(queryResults: unknown[]): PrismaClient {
  let queryIndex = 0;

  return {
    $queryRaw: async () => queryResults[queryIndex++],
  } as unknown as PrismaClient;
}
