import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localOnly = process.argv.includes('--local-only');
const downloadRemote = process.argv.includes('--download');
const allowBackendVersionMismatch = process.argv.includes('--allow-backend-version-mismatch');
const baseUrlArgument = readArgument('--base-url');
const reportArgument = readArgument('--report');
const failures = [];
const serverReport = {};

const rootPackage = await readJson('package.json');
const apiPackage = await readJson('services/backend/api/package.json');
const teacherPackage = await readJson('apps/teacher-electron/package.json');
const studentPackage = await readJson('apps/student-electron/package.json');
const versions = {
  root: rootPackage.version,
  backend: apiPackage.version,
  teacher: teacherPackage.version,
  student: studentPackage.version,
};
const expectedVersion = versions.root;
for (const [name, version] of Object.entries(versions)) {
  assert(
    version === expectedVersion,
    `versão ${name}=${version} diverge da raiz=${expectedVersion}`,
  );
}

const gitSha = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;
const configs = {
  teacher: await readJson('apps/teacher-electron/config.json'),
  student: await readJson('apps/student-electron/config.json'),
};
assert(
  configs.teacher.serverUrl === configs.student.serverUrl,
  'Teacher e Student usam serverUrl diferentes',
);
const baseUrl = (baseUrlArgument ?? configs.teacher.serverUrl).replace(/\/$/, '');

console.log(`VERSIONS ${JSON.stringify(versions)}`);
console.log(`SOURCE gitSha=${gitSha} dirty=${dirty}`);
console.log(`ENDPOINT api=${baseUrl} websocket=${baseUrl}`);

const localReleases = {};
for (const application of ['teacher', 'student']) {
  const packageMetadata = application === 'teacher' ? teacherPackage : studentPackage;
  const publishUrl = packageMetadata.build?.publish?.[0]?.url;
  const expectedUpdateUrl = `${baseUrl}/updates/${application}`;
  assert(
    publishUrl === expectedUpdateUrl,
    `${application}: provider ${publishUrl} diverge de ${expectedUpdateUrl}`,
  );

  try {
    const manifestPath = path.join(repository, 'release', application, 'latest.yml');
    const manifest = await readFile(manifestPath, 'utf8');
    const version = requireMatch(manifest, /^version:\s*(.+)$/m, `${application}: version`);
    const artifact = requireMatch(manifest, /^path:\s*(.+)$/m, `${application}: path`);
    const sha512 = requireMatch(manifest, /^sha512:\s*(.+)$/m, `${application}: sha512`);
    const artifactPath = path.join(repository, 'release', application, artifact);
    const releaseInfo = await readJson(path.join('release', application, 'release-info.json'));
    const artifactStat = await stat(artifactPath);
    const actualSha512 = await hashFile(artifactPath, 'sha512', 'base64');
    const actualSha256 = await hashFile(artifactPath, 'sha256', 'hex');
    assert(
      version === expectedVersion,
      `${application}: manifesto ${version} não é ${expectedVersion}`,
    );
    assert(actualSha512 === sha512, `${application}: SHA-512 local diverge do manifesto`);
    assert(releaseInfo.version === version, `${application}: release-info version divergente`);
    assert(
      releaseInfo.gitSha === gitSha,
      `${application}: release foi criada do SHA ${releaseInfo.gitSha}, código está em ${gitSha}`,
    );
    assert(releaseInfo.dirty === false, `${application}: release foi gerada com worktree sujo`);
    assert(releaseInfo.sha256 === actualSha256, `${application}: SHA-256 do release-info diverge`);
    assert(releaseInfo.sha512 === actualSha512, `${application}: SHA-512 do release-info diverge`);
    assert(
      releaseInfo.size === artifactStat.size,
      `${application}: tamanho do release-info diverge`,
    );
    localReleases[application] = { version, artifact, sha512, sha256: actualSha256, releaseInfo };
    console.log(
      `LOCAL ${application} version=${version} gitSha=${releaseInfo.gitSha} dirty=${releaseInfo.dirty} size=${artifactStat.size} sha256=${actualSha256}`,
    );
    console.log(
      `UPDATE_STATUS APP=${application} VERSION=${version} GIT_SHA=${releaseInfo.gitSha} UPDATE_URL=${expectedUpdateUrl} CURRENT_VERSION=${expectedVersion} AVAILABLE_VERSION=LOCAL MANIFEST_STATUS=PASS ARTIFACT_STATUS=PASS HASH_STATUS=PASS`,
    );
  } catch (error) {
    fail(`${application}: release local inválida: ${toMessage(error)}`);
  }
}

if (!localOnly) {
  for (const application of ['teacher', 'student']) {
    const local = localReleases[application];
    try {
      const manifestResponse = await fetchNoCache(`${baseUrl}/updates/${application}/latest.yml`);
      assertResponse(manifestResponse, `${application}: latest.yml`);
      const cacheControl = manifestResponse.headers.get('cache-control') ?? '';
      const manifestContentType = manifestResponse.headers.get('content-type') ?? '';
      assert(
        /no-store|no-cache/i.test(cacheControl),
        `${application}: latest.yml permite cache: ${cacheControl || '(ausente)'}`,
      );
      assert(
        /ya?ml|text\/plain|application\/octet-stream/i.test(manifestContentType) &&
          !/text\/html/i.test(manifestContentType),
        `${application}: latest.yml tem Content-Type inválido: ${manifestContentType || '(ausente)'}`,
      );
      const manifest = await manifestResponse.text();
      const remoteVersion = requireMatch(
        manifest,
        /^version:\s*(.+)$/m,
        `${application}: versão remota`,
      );
      const remoteArtifact = requireMatch(
        manifest,
        /^path:\s*(.+)$/m,
        `${application}: artefato remoto`,
      );
      const remoteSha512 = requireMatch(
        manifest,
        /^sha512:\s*(.+)$/m,
        `${application}: SHA-512 remoto`,
      );
      assert(local !== undefined, `${application}: não há release local para comparar`);
      assert(
        remoteVersion === local.version,
        `${application}: servidor anuncia ${remoteVersion}, local é ${local.version}`,
      );
      assert(remoteArtifact === local.artifact, `${application}: nome remoto diverge do local`);
      assert(remoteSha512 === local.sha512, `${application}: SHA-512 remoto diverge do local`);

      const infoResponse = await fetchNoCache(
        `${baseUrl}/updates/${application}/release-info.json`,
      );
      assertResponse(infoResponse, `${application}: release-info.json`);
      const remoteInfo = await infoResponse.json();
      assert(
        remoteInfo.gitSha === local.releaseInfo.gitSha,
        `${application}: Git SHA publicado diverge`,
      );
      assert(remoteInfo.sha256 === local.sha256, `${application}: SHA-256 publicado diverge`);

      const artifactResponse = await fetchNoCache(
        `${baseUrl}/updates/${application}/${encodeURIComponent(remoteArtifact)}`,
        downloadRemote ? 'GET' : 'HEAD',
      );
      assertResponse(artifactResponse, `${application}: artefato remoto`);
      const artifactContentType = artifactResponse.headers.get('content-type') ?? '';
      assert(
        !/text\/html/i.test(artifactContentType),
        `${application}: instalador remoto retornou HTML`,
      );
      const remoteLength = Number(artifactResponse.headers.get('content-length'));
      assert(
        remoteLength === local.releaseInfo.size,
        `${application}: tamanho remoto ${remoteLength} diverge`,
      );
      if (downloadRemote) {
        const buffer = Buffer.from(await artifactResponse.arrayBuffer());
        const downloadedSha256 = createHash('sha256').update(buffer).digest('hex');
        assert(
          downloadedSha256 === local.sha256,
          `${application}: download remoto diverge em SHA-256`,
        );
      }
      console.log(
        `REMOTE ${application} version=${remoteVersion} gitSha=${remoteInfo.gitSha} sha256=${remoteInfo.sha256}${downloadRemote ? ' download=verified' : ' download=not-requested'}`,
      );
      console.log(
        `UPDATE_STATUS APP=${application} VERSION=${local.version} GIT_SHA=${local.releaseInfo.gitSha} UPDATE_URL=${expectedUpdateUrl} CURRENT_VERSION=${expectedVersion} AVAILABLE_VERSION=${remoteVersion} MANIFEST_STATUS=PASS ARTIFACT_STATUS=PASS HASH_STATUS=PASS`,
      );
      serverReport[application] = {
        manifestHttp: manifestResponse.status,
        artifactHttp: artifactResponse.status,
        version: remoteVersion,
        gitSha: remoteInfo.gitSha,
        sha256: remoteInfo.sha256,
        cacheControl,
        downloadVerified: downloadRemote,
      };
    } catch (error) {
      fail(`${application}: diagnóstico remoto falhou: ${toMessage(error)}`);
    }
  }

  try {
    const healthResponse = await fetchNoCache(`${baseUrl}/api/health`);
    assertResponse(healthResponse, 'backend: /api/health');
    const health = await healthResponse.json();
    console.log(`BACKEND ${JSON.stringify(health)}`);
    assert(health.status === 'ok', `backend remoto reportou status ${health.status}`);
    assert(
      typeof health.version === 'string' && health.version.length > 0,
      'backend remoto não informou version',
    );
    assert(
      typeof health.gitSha === 'string' && /^[0-9a-f]{7,40}$/i.test(health.gitSha),
      `backend remoto informou Git SHA inválido: ${health.gitSha}`,
    );
    if (!allowBackendVersionMismatch) {
      assert(
        health.version === expectedVersion,
        `backend remoto ${health.version} diverge de ${expectedVersion}`,
      );
      assert(health.gitSha === gitSha, `backend remoto SHA ${health.gitSha} diverge de ${gitSha}`);
    }
    serverReport.backend = health;
  } catch (error) {
    fail(`backend: diagnóstico remoto falhou: ${toMessage(error)}`);
  }
}

if (failures.length === 0 && reportArgument !== undefined && !localOnly) {
  await enrichReleaseReport(reportArgument, serverReport);
}

if (failures.length > 0) {
  console.error(`DIAGNOSIS FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('DIAGNOSIS OK');
}

async function enrichReleaseReport(relativeReportPath, updateServer) {
  const reportPath = path.resolve(repository, relativeReportPath);
  const relative = path.relative(repository, reportPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('--report deve apontar para um arquivo dentro do repositório');
  }
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.updateServer = { status: 'PASS', baseUrl, ...updateServer };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const markdownPath = path.join(path.dirname(reportPath), 'release-report.md');
  const markdown = await readFile(markdownPath, 'utf8');
  const rows = ['teacher', 'student']
    .map((application) => {
      const entry = updateServer[application];
      return `| ${application} | ${entry.manifestHttp} | ${entry.artifactHttp} | ${entry.version} | ${entry.downloadVerified ? 'PASS' : 'NOT_REQUESTED'} |`;
    })
    .join('\n');
  await writeFile(
    markdownPath,
    `${markdown.trimEnd()}\n\n## Update server\n\nBase URL: ${baseUrl}  \nStatus: **PASS**\n\n| App | Manifest HTTP | Artifact HTTP | Version | Download/hash |\n| --- | ---: | ---: | --- | --- |\n${rows}\n`,
    'utf8',
  );
}

async function fetchNoCache(url, method = 'GET') {
  const separator = url.includes('?') ? '&' : '?';
  return fetch(`${url}${separator}diagnostic=${Date.now()}`, {
    method,
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    redirect: 'manual',
  });
}

function assertResponse(response, label) {
  if (!response.ok) throw new Error(`${label} respondeu HTTP ${response.status}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  failures.push(message);
}

function git(arguments_) {
  return execFileSync('git', arguments_, { cwd: repository, encoding: 'utf8' }).trim();
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repository, relativePath), 'utf8'));
}

async function hashFile(filePath, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest(encoding);
}

function requireMatch(value, pattern, label) {
  const match = value.match(pattern)?.[1]?.trim();
  if (match === undefined || match.length === 0) throw new Error(`${label} ausente`);
  return match;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requer valor`);
  return value;
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
