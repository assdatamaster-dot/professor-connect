import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createVersionRouter } from '../src/routes/version-router.js';
import { compareVersions } from '../src/version/version.service.js';
import type {
  PublishReleaseInput,
  UpdateEventInput,
  VersionApplication,
  VersionChannel,
  VersionCheckInput,
  VersionServiceContract,
} from '../src/version/version.types.js';

class FakeVersionService implements VersionServiceContract {
  public readonly events: UpdateEventInput[] = [];
  public latest(application: VersionApplication, channel: VersionChannel): Promise<unknown> {
    return Promise.resolve({
      version: '1.2.0',
      application,
      channel,
      releaseNotes: { news: ['Atualização automática'] },
      url: 'https://updates.example/installer.exe',
      hash: 'sha512',
      checksum: 'sha256',
      date: '2026-08-06T18:00:00.000Z',
    });
  }
  public check(input: VersionCheckInput): Promise<unknown> {
    return Promise.resolve({ status: input.currentVersion === '1.2.0' ? 'updated' : 'update' });
  }
  public recordEvent(input: UpdateEventInput): Promise<void> {
    this.events.push(input);
    return Promise.resolve();
  }
  public metrics(): Promise<unknown> {
    return Promise.resolve({ items: [] });
  }
  public publish(input: PublishReleaseInput): Promise<unknown> {
    return Promise.resolve(input);
  }
}

test('GET /api/version/latest entrega metadados completos por canal', async () => {
  const fixture = await serverFixture();
  try {
    const response = await fetch(
      `${fixture.url}/api/version/latest?application=student&channel=beta`,
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.version, '1.2.0');
    assert.equal(body.channel, 'beta');
    assert.equal(body.checksum, 'sha256');
  } finally {
    await fixture.close();
  }
});

test('GET /api/version/check responde update ou updated', async () => {
  const fixture = await serverFixture();
  try {
    const update = await fetch(
      `${fixture.url}/api/version/check?application=teacher&channel=stable&currentVersion=1.0.0`,
    );
    assert.equal(((await update.json()) as { status: string }).status, 'update');
    const current = await fetch(
      `${fixture.url}/api/version/check?application=teacher&channel=stable&currentVersion=1.2.0`,
    );
    assert.equal(((await current.json()) as { status: string }).status, 'updated');
  } finally {
    await fixture.close();
  }
});

test('POST /api/version/events persiste contrato de auditoria', async () => {
  const fixture = await serverFixture();
  try {
    const response = await fetch(`${fixture.url}/api/version/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: '10000000-0000-4000-8000-000000000001',
        application: 'teacher',
        channel: 'stable',
        event: 'download_completed',
        previousVersion: '1.0.0',
        newVersion: '1.2.0',
        durationMilliseconds: 4200,
      }),
    });
    assert.equal(response.status, 202);
    assert.equal(fixture.service.events[0]?.event, 'download_completed');
  } finally {
    await fixture.close();
  }
});

test('comparação de versões respeita releases estáveis e pré-releases', () => {
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
});

async function serverFixture(): Promise<{
  url: string;
  service: FakeVersionService;
  close(): Promise<void>;
}> {
  const service = new FakeVersionService();
  const app = express();
  app.use(express.json());
  app.use('/api/version', createVersionRouter(service));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    service,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error))),
      ),
  };
}
