import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArgument('--mode') ?? 'qa';

if (mode !== 'qa' && mode !== 'release') {
  throw new Error('--mode deve ser qa ou release');
}

const packages = {
  root: await readJson('package.json'),
  backend: await readJson('services/backend/api/package.json'),
  teacher: await readJson('apps/teacher-electron/package.json'),
  student: await readJson('apps/student-electron/package.json'),
};
const version = packages.root.version;

if (!isSemanticVersion(version)) throw new Error(`Versão SemVer inválida: ${version}`);
for (const [name, metadata] of Object.entries(packages)) {
  if (metadata.version !== version) {
    throw new Error(`Versão ${name}=${metadata.version} diverge da raiz=${version}`);
  }
}

const status = git(['status', '--porcelain']);
if (status.length > 0) {
  throw new Error('Release recusada: o worktree contém alterações ou arquivos não rastreados');
}

const gitSha = git(['rev-parse', 'HEAD']);
const githubSha = process.env.GITHUB_SHA?.trim();
if (githubSha !== undefined && githubSha.length > 0 && githubSha !== gitSha) {
  throw new Error(`GITHUB_SHA ${githubSha} diverge do checkout ${gitSha}`);
}

const suppliedTag = readArgument('--tag') ?? process.env.GITHUB_REF_NAME?.trim();
if (mode === 'release') {
  const expectedTag = `v${version}`;
  if (suppliedTag !== expectedTag) {
    throw new Error(`Tag oficial deve ser ${expectedTag}; recebida: ${suppliedTag ?? '(ausente)'}`);
  }
  if (process.env.GITHUB_REF_TYPE !== undefined && process.env.GITHUB_REF_TYPE !== 'tag') {
    throw new Error('Release oficial só pode executar a partir de uma tag');
  }
}

const result = { mode, version, gitSha, dirty: false, tag: suppliedTag ?? null };
process.stdout.write(`RELEASE_CONTEXT ${JSON.stringify(result)}\n`);

if (process.env.GITHUB_OUTPUT !== undefined) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `mode=${mode}\nversion=${version}\ngit_sha=${gitSha}\ntag=${suppliedTag ?? ''}\n`,
    'utf8',
  );
}

function isSemanticVersion(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
    value,
  );
}

function git(arguments_) {
  return execFileSync('git', arguments_, { cwd: repository, encoding: 'utf8' }).trim();
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repository, relativePath), 'utf8'));
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requer valor`);
  return value;
}
