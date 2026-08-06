import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { UpdateChannel } from './contracts.js';

export class VersionService {
  public constructor(
    public readonly currentVersion: string,
    private readonly userDataPath: string,
  ) {}

  public updaterChannel(channel: UpdateChannel): 'latest' | 'beta' | 'alpha' {
    if (channel === 'stable') return 'latest';
    if (channel === 'beta') return 'beta';
    return 'alpha';
  }

  public allowsPrerelease(channel: UpdateChannel): boolean {
    return channel !== 'stable';
  }

  public async installationId(): Promise<string> {
    const filePath = path.join(this.userDataPath, 'update-manager', 'installation-id');
    try {
      const existing = (await readFile(filePath, 'utf8')).trim();
      if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    } catch {
      // First launch: create a stable, non-identifying installation id.
    }
    const id = randomUUID();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, id, { encoding: 'utf8', mode: 0o600 });
    return id;
  }

  public static compare(left: string, right: string): number {
    const a = parseVersion(left);
    const b = parseVersion(right);
    for (let index = 0; index < 3; index += 1) {
      const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
      if (difference !== 0) return Math.sign(difference);
    }
    if (a.prerelease === b.prerelease) return 0;
    if (a.prerelease === '') return 1;
    if (b.prerelease === '') return -1;
    return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
  }
}

function parseVersion(value: string): { numbers: readonly number[]; prerelease: string } {
  const normalized = value.trim().replace(/^v/i, '');
  const [core = '0.0.0', prerelease = ''] = normalized.split('-', 2);
  const numbers = core
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
  return { numbers, prerelease };
}
