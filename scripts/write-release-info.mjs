import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const application = process.argv[2];

if (application !== 'teacher' && application !== 'student') {
  throw new Error('Uso: node scripts/write-release-info.mjs <teacher|student>');
}

const releaseDirectory = path.join(repository, 'release', application);
const metadata = await readFile(path.join(releaseDirectory, 'latest.yml'), 'utf8');
const artifact = requireMatch(metadata, /^path:\s*(.+)$/m, 'path');
const manifestSha512 = requireMatch(metadata, /^sha512:\s*(.+)$/m, 'sha512');
const version = requireMatch(metadata, /^version:\s*(.+)$/m, 'version');
const buildInfo = JSON.parse(
  await readFile(
    path.join(repository, 'apps', `${application}-electron`, 'dist', 'build-info.json'),
    'utf8',
  ),
);

if (buildInfo.application !== application || buildInfo.version !== version) {
  throw new Error(`${application}: identidade do build não corresponde ao manifesto ${version}`);
}

const artifactPath = path.join(releaseDirectory, artifact);
const artifactStat = await stat(artifactPath);
const sha512 = await hashFile(artifactPath, 'sha512', 'base64');
if (sha512 !== manifestSha512) throw new Error(`${application}: SHA-512 divergente`);

const releaseInfo = {
  ...buildInfo,
  artifact,
  target: 'nsis',
  architecture: 'x64',
  size: artifactStat.size,
  sha256: await hashFile(artifactPath, 'sha256', 'hex'),
  sha512,
};

await writeFile(
  path.join(releaseDirectory, 'release-info.json'),
  `${JSON.stringify(releaseInfo, null, 2)}\n`,
  'utf8',
);
process.stdout.write(
  `${application}: release-info.json ${releaseInfo.version} ${releaseInfo.gitSha.slice(0, 7)} ${releaseInfo.sha256}\n`,
);

async function hashFile(filePath, algorithm, encoding) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest(encoding);
}

function requireMatch(value, pattern, label) {
  const match = value.match(pattern)?.[1]?.trim();
  if (match === undefined || match.length === 0)
    throw new Error(`${application}: ${label} ausente`);
  return match;
}
