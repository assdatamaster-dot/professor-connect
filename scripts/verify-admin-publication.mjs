const target = process.argv[2];

if (target === undefined) {
  throw new Error(
    'Informe a origem publicada. Exemplo: npm run verify-admin-publication -- https://api.example.com',
  );
}

const origin = new URL(target).origin;
const adminUrl = new URL('/admin', origin);
const requestHeaders = { Origin: origin };
const page = await fetch(adminUrl, { headers: requestHeaders, redirect: 'follow' });

assertResponse(page, 200, 'HTML do painel');
assertContentType(page, /^text\/html\b/i, 'HTML do painel');

const html = await page.text();
const assetPaths = [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/gi)].map(
  (match) => match[1],
);

if (assetPaths.length === 0) throw new Error('O HTML do painel não referencia assets JS/CSS');

for (const assetPath of assetPaths) {
  if (!assetPath.startsWith('/admin/assets/')) {
    throw new Error(`Asset fora do base path /admin/assets: ${assetPath}`);
  }

  const response = await fetch(new URL(assetPath, origin), { headers: requestHeaders });
  assertResponse(response, 200, assetPath);
  assertContentType(
    response,
    assetPath.endsWith('.css') ? /^text\/css\b/i : /^(?:text|application)\/javascript\b/i,
    assetPath,
  );

  const cacheControl = response.headers.get('cache-control') ?? '';
  if (!/\bimmutable\b/i.test(cacheControl)) {
    throw new Error(`${assetPath} não possui cache imutável de produção`);
  }

  console.log(`OK ${response.status} ${response.headers.get('content-type')} ${assetPath}`);
}

const missingAsset = await fetch(new URL('/admin/assets/publication-check-missing.js', origin), {
  headers: requestHeaders,
});
assertResponse(missingAsset, 404, 'asset inexistente');

if (/^text\/html\b/i.test(missingAsset.headers.get('content-type') ?? '')) {
  throw new Error('Asset inexistente recebeu indevidamente o fallback HTML da SPA');
}

console.log(`Painel administrativo publicado corretamente em ${adminUrl.href}`);

function assertResponse(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(
      `${label}: esperado HTTP ${expectedStatus}, recebido ${response.status} ${response.statusText}`,
    );
  }
}

function assertContentType(response, expected, label) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!expected.test(contentType)) {
    throw new Error(`${label}: Content-Type inesperado: ${contentType || '(ausente)'}`);
  }
}
