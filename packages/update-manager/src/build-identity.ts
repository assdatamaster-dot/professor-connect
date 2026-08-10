import { readFile } from 'node:fs/promises';

import type { BuildIdentity, UpdateApplication } from './contracts.js';

export async function readBuildIdentity(
  filePath: string,
  expectedApplication: UpdateApplication,
  expectedVersion: string,
): Promise<BuildIdentity> {
  const value = JSON.parse(await readFile(filePath, 'utf8')) as Partial<BuildIdentity>;
  if (
    value.application !== expectedApplication ||
    value.version !== expectedVersion ||
    typeof value.gitSha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(value.gitSha) ||
    typeof value.buildDate !== 'string' ||
    Number.isNaN(Date.parse(value.buildDate)) ||
    typeof value.buildId !== 'string' ||
    value.buildId.length === 0 ||
    typeof value.dirty !== 'boolean'
  ) {
    throw new Error('Identidade do build ausente, inválida ou divergente do aplicativo');
  }
  return value as BuildIdentity;
}
