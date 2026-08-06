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
  const artifactPath = path.join(sourceDirectory, artifactName);
  if (!(await stat(artifactPath)).isFile()) throw new Error(`${application}: instalador ausente`);
  if ((await hashFile(artifactPath)) !== expectedSha512) {
    throw new Error(`${application}: SHA-512 divergente`);
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
    ]) {
      await copyFile(path.join(sourceDirectory, fileName), path.join(destination, fileName));
    }
  }
  process.stdout.write(
    `${application}: ${artifactName} (${verifyOnly ? 'verificado' : 'verificado e preparado'})\n`,
  );
}

async function hashFile(filePath) {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('base64');
}

function requireMatch(value, pattern, label) {
  const match = value.match(pattern)?.[1]?.trim();
  if (match === undefined || match.length === 0) throw new Error(`${label} ausente`);
  return match;
}
