import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { createApp } from '../src/app.js';

test('publica o painel e seus assets para a mesma origem', async () => {
  const server = createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const origin = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${origin}/admin`, { headers: { Origin: origin } });

    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') ?? '', /^text\/html\b/);
    assert.equal(page.headers.get('access-control-allow-origin'), origin);

    const html = await page.text();
    const scriptPath = html.match(/src="([^"?]+\.js)"/)?.[1];
    const stylePath = html.match(/href="([^"?]+\.css)"/)?.[1];

    assert.match(scriptPath ?? '', /^\/admin\/assets\/[A-Za-z0-9._-]+\.js$/);
    assert.match(stylePath ?? '', /^\/admin\/assets\/[A-Za-z0-9._-]+\.css$/);
    assert(scriptPath !== undefined);
    assert(stylePath !== undefined);

    const [script, style] = await Promise.all([
      fetch(`${origin}${scriptPath}`, { headers: { Origin: origin } }),
      fetch(`${origin}${stylePath}`, { headers: { Origin: origin } }),
    ]);

    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /^(?:text|application)\/javascript\b/);
    assert.equal(style.status, 200);
    assert.match(style.headers.get('content-type') ?? '', /^text\/css\b/);

    const missingAsset = await fetch(`${origin}/admin/assets/missing.js`, {
      headers: { Origin: origin },
    });
    assert.equal(missingAsset.status, 404);
    assert.doesNotMatch(missingAsset.headers.get('content-type') ?? '', /^text\/html\b/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});

test('mantém bloqueio CORS para uma origem externa não autorizada', async () => {
  const server = createServer(createApp());

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    assert(address !== null && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { Origin: 'https://origem-nao-autorizada.example' },
    });

    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, 'cors_forbidden');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
