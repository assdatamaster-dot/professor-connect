import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { AppUpdaterLike, UpdateInfoLike } from '../src/contracts.js';
import { ReleaseNotesService } from '../src/release-notes-service.js';
import { RollbackManager } from '../src/rollback-manager.js';
import { UpdateManager } from '../src/update-manager.js';
import { VersionService } from '../src/version-service.js';

class FakeUpdater extends EventEmitter implements AppUpdaterLike {
  public autoDownload = false;
  public autoInstallOnAppQuit = true;
  public allowPrerelease = false;
  public channel: string | null = null;
  public installed = false;
  public mode: 'available' | 'current' | 'offline' = 'available';
  public interruptDownload = false;
  public readonly info: UpdateInfoLike = {
    version: '1.1.0',
    releaseDate: '2026-08-06T18:00:00.000Z',
    releaseNotes: '# Novidades\n- Atualização inteligente\n# Correções\n- Rede resiliente',
  };

  public checkForUpdates(): Promise<unknown> {
    this.emit('checking-for-update');
    if (this.mode === 'offline') return Promise.reject(new Error('internet lost'));
    this.emit(this.mode === 'available' ? 'update-available' : 'update-not-available', this.info);
    return Promise.resolve(undefined);
  }

  public downloadUpdate(): Promise<readonly string[]> {
    if (this.interruptDownload) return Promise.reject(new Error('download interrupted'));
    this.emit('download-progress', {
      percent: 65,
      bytesPerSecond: 1_048_576,
      transferred: 65,
      total: 100,
    });
    this.emit('update-downloaded', this.info);
    return Promise.resolve([]);
  }

  public quitAndInstall(): void {
    this.installed = true;
  }
}

async function fixture(): Promise<{
  manager: UpdateManager;
  updater: FakeUpdater;
  directory: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-update-test-'));
  const updater = new FakeUpdater();
  const manager = new UpdateManager({
    updater,
    application: 'teacher',
    currentVersion: '1.0.0',
    userDataPath: directory,
    serverUrl: 'http://127.0.0.1:9',
    isPackaged: true,
    quitApplication: () => undefined,
    webContents: () => undefined,
    startupDelayMilliseconds: 3_600_000,
  });
  await manager.start();
  return { manager, updater, directory };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  value.manager.dispose();
  await rm(value.directory, { recursive: true, force: true });
}

test('nova versão é encontrada e baixada silenciosamente', async () => {
  const value = await fixture();
  try {
    await value.manager.check();
    await waitFor(() => value.manager.getState().phase === 'downloaded');
    assert.equal(value.manager.getState().newVersion, '1.1.0');
  } finally {
    await cleanup(value);
  }
});

test('sem atualização mantém o cliente atualizado', async () => {
  const value = await fixture();
  try {
    value.updater.mode = 'current';
    await value.manager.check();
    assert.equal(value.manager.getState().phase, 'up-to-date');
  } finally {
    await cleanup(value);
  }
});

test('download interrompido é recuperável e auditado como falha', async () => {
  const value = await fixture();
  try {
    value.updater.interruptDownload = true;
    await value.manager.check();
    await waitFor(() => value.manager.getState().phase === 'error');
    assert.equal(value.manager.getState().errorCode, 'update_failed');
  } finally {
    await cleanup(value);
  }
});

test('internet perdida não derruba a aplicação', async () => {
  const value = await fixture();
  try {
    value.updater.mode = 'offline';
    await value.manager.check();
    assert.equal(value.manager.getState().phase, 'error');
  } finally {
    await cleanup(value);
  }
});

test('modo perguntar aguarda autorização antes do download', async () => {
  const value = await fixture();
  try {
    await value.manager.saveSettings({ automaticDownload: false });
    await value.manager.check();
    await waitFor(() => value.manager.getState().phase === 'available');
    assert.equal(value.manager.getState().progress, undefined);
  } finally {
    await cleanup(value);
  }
});

test('reinício inicia a instalação automática já baixada', async () => {
  const value = await fixture();
  try {
    await value.manager.check();
    await waitFor(() => value.manager.getState().phase === 'downloaded');
    await value.manager.install();
    assert.equal(value.updater.installed, true);
    assert.equal(value.manager.getState().phase, 'installing');
  } finally {
    await cleanup(value);
  }
});

test('atualização nunca instala durante atendimento e instala após encerrá-lo', async () => {
  const value = await fixture();
  try {
    value.manager.setAttendanceActive(true);
    await value.manager.check();
    await waitFor(() => value.manager.getState().phase === 'deferred');
    await value.manager.install();
    assert.equal(value.updater.installed, false);
    assert.match(value.manager.getState().message, /atendimento for encerrado/);
    value.manager.setAttendanceActive(false);
    await waitFor(() => value.updater.installed, 2_000);
    assert.equal(value.updater.installed, true);
  } finally {
    await cleanup(value);
  }
});

test(
  'arquivo corrompido é rejeitado antes da instalação',
  { skip: process.platform !== 'win32' },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pc-corrupt-test-'));
    try {
      const installer = path.join(directory, 'update.exe');
      await writeFile(installer, 'corrupted');
      const rollback = new RollbackManager(directory);
      await assert.rejects(
        rollback.prepareCandidate('1.1.0', installer, 'checksum-inválido'),
        /SHA-512/,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('serviços de versão e changelog tratam canais e categorias', () => {
  const notes = new ReleaseNotesService().parse(
    '# Novidades\n- A\n# Correções\n- B\n# Melhorias\n- C',
  );
  assert.deepEqual(notes.news, ['A']);
  assert.deepEqual(notes.fixes, ['B']);
  assert.deepEqual(notes.improvements, ['C']);
  assert.equal(VersionService.compare('1.2.0', '1.1.9'), 1);
  assert.equal(VersionService.compare('1.2.0-beta.1', '1.2.0'), -1);
});

async function waitFor(predicate: () => boolean, timeout = 1_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timeout');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
