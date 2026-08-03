import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

import type { AuthTokenStore, StoredAuthSession } from './index.js';

export class ElectronSecureTokenStore implements AuthTokenStore {
  private readonly tokenPath: string;
  private memorySession: StoredAuthSession | undefined;

  public constructor(userDataPath: string, fileName = 'authentication.bin') {
    this.tokenPath = path.join(userDataPath, fileName);
  }

  public async load(): Promise<StoredAuthSession | undefined> {
    if (!safeStorage.isEncryptionAvailable()) return this.memorySession;
    try {
      const encrypted = await readFile(this.tokenPath);
      return JSON.parse(safeStorage.decryptString(encrypted)) as StoredAuthSession;
    } catch (error) {
      if (isFileMissing(error)) return undefined;
      await this.clear();
      return undefined;
    }
  }

  public async save(session: StoredAuthSession): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      this.memorySession = session;
      return;
    }
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporaryPath = `${this.tokenPath}.tmp`;
    await writeFile(temporaryPath, safeStorage.encryptString(JSON.stringify(session)), {
      mode: 0o600,
    });
    await rename(temporaryPath, this.tokenPath);
  }

  public async clear(): Promise<void> {
    this.memorySession = undefined;
    await unlink(this.tokenPath).catch((error: unknown) => {
      if (!isFileMissing(error)) throw error;
    });
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
