import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifyOnly = process.argv.includes('--verify-only');

for (const application of ['teacher', 'student']) {
  const sourceDirectory = path.join(repository, 'release', application);
  const metadata = await readFile(path.join(sourceDirectory, 'latest.yml'), 'utf8');
  const artifactName = requireMatch(metadata, /^path:\s*(.+)$/m, `${application}: path`);
  const expectedSha512 = requireMatch(metadata, /^sha512:\s*(.+)$/m, `${application}: sha512`);
  const expectedSize = Number(
    requireMatch(metadata, /^\s+size:\s*(\d+)$/m, `${application}: size`),
  );
  const artifactPath = path.join(sourceDirectory, artifactName);
  const releaseInfo = JSON.parse(
    await readFile(path.join(sourceDirectory, 'release-info.json'), 'utf8'),
  );
  const artifactStat = await stat(artifactPath);
  if (!artifactStat.isFile()) throw new Error(`${application}: instalador ausente`);
  if (artifactStat.size !== expectedSize) throw new Error(`${application}: tamanho divergente`);
  if ((await hashFile(artifactPath, 'sha512', 'base64')) !== expectedSha512) {
    throw new Error(`${application}: SHA-512 divergente`);
  }
  const actualSha256 = await hashFile(artifactPath, 'sha256', 'hex');
  if (
    releaseInfo.application !== application ||
    releaseInfo.version !==
      requireMatch(metadata, /^version:\s*(.+)$/m, `${application}: version`) ||
    releaseInfo.artifact !== artifactName ||
    releaseInfo.sha512 !== expectedSha512 ||
    releaseInfo.sha256 !== actualSha256 ||
    releaseInfo.size !== expectedSize ||
    releaseInfo.dirty !== false
  ) {
    throw new Error(`${application}: release-info.json inválido ou build não commitado`);
  }
  const blockmapPath = `${artifactPath}.blockmap`;
  if (!(await stat(blockmapPath)).isFile()) throw new Error(`${application}: blockmap ausente`);
  for (const channel of ['latest', 'beta', 'alpha']) {
    const channelMetadata = await readFile(path.join(sourceDirectory, `${channel}.yml`), 'utf8');
    if (!channelMetadata.includes(expectedSha512)) {
      throw new Error(`${application}: ${channel}.yml não corresponde ao instalador`);
    }
  }
  if (!verifyOnly) {
    const destination = path.join(repository, 'release-updates', application);
    await mkdir(destination, { recursive: true });
    for (const fileName of [
      artifactName,
      `${artifactName}.blockmap`,
      'latest.yml',
      'beta.yml',
      'alpha.yml',
      'release-info.json',
    ]) {
      await copyFile(path.join(sourceDirectory, fileName), path.join(destination, fileName));
    }
  }
  process.stdout.write(
    `${application}: ${artifactName} (${verifyOnly ? 'verificado' : 'verificado e preparado'})\n`,
  );
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
