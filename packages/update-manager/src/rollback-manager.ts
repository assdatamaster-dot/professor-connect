import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

interface InstallerRecord {
  readonly version: string;
  readonly path: string;
  readonly sha512: string;
}

interface RollbackState {
  readonly current?: InstallerRecord;
  readonly candidate?: InstallerRecord;
  readonly pendingVersion?: string;
  readonly launchAttempts?: number;
}

export type RollbackStartupResult = 'none' | 'pending-health-check' | 'rollback-started';

export class RollbackManager {
  private readonly directory: string;
  private readonly statePath: string;

  public constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'update-manager', 'rollback');
    this.statePath = path.join(this.directory, 'state.json');
  }

  public async prepareCandidate(
    version: string,
    downloadedFile: string | undefined,
    expectedSha512: string | undefined,
  ): Promise<void> {
    if (downloadedFile === undefined || process.platform !== 'win32') return;
    const source = path.resolve(downloadedFile);
    if (!(await stat(source)).isFile()) throw new Error('O instalador baixado não é válido');
    const actualSha512 = await hashFile(source);
    if (expectedSha512 !== undefined && actualSha512 !== expectedSha512) {
      throw new Error('Falha na verificação SHA-512 do instalador baixado');
    }
    await mkdir(this.directory, { recursive: true });
    const destination = path.join(this.directory, `candidate-${safeVersion(version)}.exe`);
    await copyFile(source, destination);
    const state = await this.readState();
    await this.writeState({
      ...state,
      candidate: { version, path: destination, sha512: actualSha512 },
    });
  }

  public async markInstallationPending(version: string): Promise<void> {
    await this.writeState({
      ...(await this.readState()),
      pendingVersion: version,
      launchAttempts: 0,
    });
  }

  public async handleStartup(currentVersion: string): Promise<RollbackStartupResult> {
    const state = await this.readState();
    if (state.pendingVersion !== currentVersion) return 'none';
    const launchAttempts = (state.launchAttempts ?? 0) + 1;
    await this.writeState({ ...state, launchAttempts });
    if (launchAttempts < 3 || state.current === undefined || process.platform !== 'win32') {
      return 'pending-health-check';
    }
    await this.launchInstaller(state.current);
    return 'rollback-started';
  }

  public async markHealthy(currentVersion: string): Promise<void> {
    const state = await this.readState();
    if (state.pendingVersion !== currentVersion) return;
    const current = state.candidate?.version === currentVersion ? state.candidate : state.current;
    await this.writeState(current === undefined ? {} : { current });
  }

  public async rollbackNow(): Promise<boolean> {
    const state = await this.readState();
    if (state.current === undefined || process.platform !== 'win32') return false;
    await this.launchInstaller(state.current);
    return true;
  }

  private async launchInstaller(installer: InstallerRecord): Promise<void> {
    if ((await hashFile(installer.path)) !== installer.sha512) {
      throw new Error('O instalador de rollback perdeu a integridade');
    }
    const child = spawn(installer.path, ['/S'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }

  private async readState(): Promise<RollbackState> {
    try {
      return JSON.parse(await readFile(this.statePath, 'utf8')) as RollbackState;
    } catch {
      return {};
    }
  }

  private async writeState(state: RollbackState): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.statePath);
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

function safeVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z.-]/g, '_');
}
