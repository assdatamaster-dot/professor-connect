import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { safeStorage } from 'electron';

export interface StoredSessionRecovery {
  readonly sessionId: string;
  readonly recoveryToken: string;
  readonly peerName: string;
  readonly savedAt: string;
  readonly recoveryDeadline?: string;
  readonly teacherId?: string;
  readonly teacherName?: string;
  readonly studentId?: string;
  readonly studentName?: string;
}

export interface SessionRecoveryStore {
  load(): Promise<StoredSessionRecovery | undefined>;
  save(recovery: StoredSessionRecovery): Promise<void>;
  clear(): Promise<void>;
}

/** Encrypted, atomic local storage for the participant's opaque recovery token. */
export class ElectronSessionRecoveryStore implements SessionRecoveryStore {
  private readonly recoveryPath: string;
  private memoryRecovery: StoredSessionRecovery | undefined;

  public constructor(userDataPath: string, fileName = 'session-recovery.bin') {
    this.recoveryPath = path.join(userDataPath, fileName);
  }

  public async load(): Promise<StoredSessionRecovery | undefined> {
    if (!safeStorage.isEncryptionAvailable()) return this.memoryRecovery;
    try {
      const encrypted = await readFile(this.recoveryPath);
      return JSON.parse(safeStorage.decryptString(encrypted)) as StoredSessionRecovery;
    } catch (error) {
      if (isFileMissing(error)) return undefined;
      await this.clear();
      return undefined;
    }
  }

  public async save(recovery: StoredSessionRecovery): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      this.memoryRecovery = recovery;
      return;
    }
    await mkdir(path.dirname(this.recoveryPath), { recursive: true });
    const temporaryPath = `${this.recoveryPath}.tmp`;
    await writeFile(temporaryPath, safeStorage.encryptString(JSON.stringify(recovery)), {
      mode: 0o600,
    });
    await rename(temporaryPath, this.recoveryPath);
  }

  public async clear(): Promise<void> {
    this.memoryRecovery = undefined;
    await unlink(this.recoveryPath).catch((error: unknown) => {
      if (!isFileMissing(error)) throw error;
    });
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
