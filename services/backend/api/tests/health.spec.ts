import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('GET /health responde com o estado da aplicação', async () => {
  const updateArtifactsDirectory = await mkdtemp(join(tmpdir(), 'professor-connect-updates-'));
  const teacherDirectory = join(updateArtifactsDirectory, 'teacher');
  await mkdir(teacherDirectory);
  await writeFile(
    join(teacherDirectory, 'latest.yml'),
    'version: 0.1.3\npath: teacher.exe\nsha512: test\n',
    'utf8',
  );
  await writeFile(join(teacherDirectory, 'teacher.exe'), 'installer fixture', 'utf8');
  process.env.UPDATE_ARTIFACTS_PATH = updateArtifactsDirectory;
  const { createApp } = await import('../src/app.js');
  const server = createServer(createApp());

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    assert.equal(response.status, 200);
    assert.doesNotMatch(
      response.headers.get('content-security-policy') ?? '',
      /(?:^|;)upgrade-insecure-requests(?:;|$)/,
    );
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.status, 'ok');
    assert.equal(body.version, '0.1.3');
    assert.equal(typeof body.environment, 'string');
    assert.equal(typeof body.gitSha, 'string');
    assert.equal(typeof body.buildDate, 'string');

    const apiResponse = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(apiResponse.status, 200);

    const manifest = await fetch(`http://127.0.0.1:${address.port}/updates/teacher/latest.yml`);
    assert.equal(manifest.status, 200);
    assert.match(manifest.headers.get('content-type') ?? '', /text\/yaml/);
    assert.match(manifest.headers.get('cache-control') ?? '', /no-store/);
    assert.doesNotMatch(await manifest.text(), /<html/i);

    const installer = await fetch(`http://127.0.0.1:${address.port}/updates/teacher/teacher.exe`);
    assert.equal(installer.status, 200);
    assert.equal(installer.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    await rm(updateArtifactsDirectory, { recursive: true, force: true });
    const missingUpdate = await fetch(
      `http://127.0.0.1:${address.port}/updates/teacher/missing.yml`,
    );
    assert.equal(missingUpdate.status, 404);
    assert.equal(missingUpdate.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await rm(updateArtifactsDirectory, { recursive: true, force: true });
  }
});
