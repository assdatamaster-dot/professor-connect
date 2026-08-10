import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const application = process.argv[2];

if (application !== 'teacher' && application !== 'student') {
  throw new Error('Uso: node scripts/generate-build-info.mjs <teacher|student>');
}

const applicationDirectory = path.join(repository, 'apps', `${application}-electron`);
const packageMetadata = JSON.parse(
  await readFile(path.join(applicationDirectory, 'package.json'), 'utf8'),
);
const gitSha = git(['rev-parse', 'HEAD']);
const dirty = git(['status', '--porcelain']).length > 0;
const buildDate = normalizeBuildDate(process.env.BUILD_DATE);
const shortSha = gitSha.slice(0, 7);
const buildInfo = {
  application,
  version: packageMetadata.version,
  gitSha,
  buildDate,
  dirty,
  buildId: `${packageMetadata.version}+${shortSha}${dirty ? '.dirty' : ''}`,
};
const outputPath = path.join(applicationDirectory, 'dist', 'build-info.json');

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
process.stdout.write(
  `${application}: build ${buildInfo.buildId} (${buildInfo.buildDate}) gravado em ${path.relative(repository, outputPath)}\n`,
);

function git(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repository,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeBuildDate(value) {
  if (value === undefined || value.trim() === '') return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('BUILD_DATE deve ser uma data ISO válida');
  return parsed.toISOString();
}
