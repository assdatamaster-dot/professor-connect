import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as asar from '@electron/asar';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireSignature = process.argv.includes('--require-signature');
const expectedVersion = readArgument('--version') ?? (await readJson('package.json')).version;
const expectedGitSha = readArgument('--git-sha') ?? git(['rev-parse', 'HEAD']);
const releaseRoot = path.join(repository, 'release');
const stagedRoot = path.join(repository, 'release-updates');
const results = [];

for (const application of ['teacher', 'student']) {
  const releaseDirectory = path.join(releaseRoot, application);
  const releaseInfo = await readJson(path.join('release', application, 'release-info.json'));
  const manifest = await readFile(path.join(releaseDirectory, 'latest.yml'), 'utf8');
  const artifactName = requireMatch(manifest, /^path:\s*(.+)$/m, `${application}: path`);
  const manifestVersion = requireMatch(manifest, /^version:\s*(.+)$/m, `${application}: version`);
  const artifactPath = path.join(releaseDirectory, artifactName);
  const artifactStat = await stat(artifactPath);
  const sha256 = await hashFile(artifactPath, 'sha256', 'hex');
  const sha512 = await hashFile(artifactPath, 'sha512', 'base64');

  assert(manifestVersion === expectedVersion, `${application}: versão do manifesto divergente`);
  assert(
    releaseInfo.version === expectedVersion,
    `${application}: release-info version divergente`,
  );
  assert(releaseInfo.gitSha === expectedGitSha, `${application}: Git SHA divergente`);
  assert(releaseInfo.dirty === false, `${application}: build dirty não pode ser promovido`);
  assert(releaseInfo.sha256 === sha256, `${application}: SHA-256 divergente`);
  assert(releaseInfo.sha512 === sha512, `${application}: SHA-512 divergente`);
  assert(releaseInfo.size === artifactStat.size, `${application}: tamanho divergente`);
  assert(releaseInfo.target === 'nsis', `${application}: target não é NSIS`);
  assert(releaseInfo.architecture === 'x64', `${application}: arquitetura não é x64`);

  const applicationPackage = await readJson(`apps/${application}-electron/package.json`);
  const asarPath = path.join(releaseDirectory, 'win-unpacked', 'resources', 'app.asar');
  const embeddedIdentity = JSON.parse(asar.extractFile(asarPath, 'dist\\build-info.json'));
  assert(
    embeddedIdentity.version === expectedVersion &&
      embeddedIdentity.gitSha === expectedGitSha &&
      embeddedIdentity.dirty === false,
    `${application}: identidade embutida no ASAR é inválida`,
  );
  validateExpectedCode(application, asarPath);

  const installedExecutable = path.join(
    releaseDirectory,
    'win-unpacked',
    `${applicationPackage.build.win.executableName}.exe`,
  );
  const installerSignature = authenticode(artifactPath);
  const applicationSignature = authenticode(installedExecutable);
  if (requireSignature) {
    assert(
      installerSignature.status === 'Valid',
      `${application}: instalador sem assinatura válida`,
    );
    assert(
      applicationSignature.status === 'Valid',
      `${application}: executável sem assinatura válida`,
    );
  }

  results.push({
    application,
    version: expectedVersion,
    gitSha: expectedGitSha,
    buildId: releaseInfo.buildId,
    buildDate: releaseInfo.buildDate,
    artifact: artifactName,
    size: artifactStat.size,
    sha256,
    sha512,
    target: releaseInfo.target,
    architecture: releaseInfo.architecture,
    signature: {
      installer: installerSignature.status,
      application: applicationSignature.status,
      signer: installerSignature.signer,
    },
  });
}

await mkdir(stagedRoot, { recursive: true });
const report = {
  status: 'PASS',
  mode: requireSignature ? 'release' : 'qa',
  version: expectedVersion,
  gitSha: expectedGitSha,
  generatedAt: new Date().toISOString(),
  applications: results,
};
const jsonPath = path.join(stagedRoot, 'release-report.json');
const markdownPath = path.join(stagedRoot, 'release-report.md');
const sumsPath = path.join(stagedRoot, 'SHA256SUMS.txt');
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(markdownPath, renderMarkdown(report), 'utf8');
await writeFile(
  sumsPath,
  `${results.map((entry) => `${entry.sha256}  ${entry.application}/${entry.artifact}`).join('\n')}\n`,
  'utf8',
);

process.stdout.write(`RELEASE_VALIDATION ${JSON.stringify(report)}\n`);
if (process.env.GITHUB_OUTPUT !== undefined) {
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `report=${path.relative(repository, markdownPath)}\nversion=${expectedVersion}\ngit_sha=${expectedGitSha}\n`,
    'utf8',
  );
}

function validateExpectedCode(application, asarPath) {
  const markers =
    application === 'teacher'
      ? ['students:presence:get', 'students:presence:changed', 'online-students-list']
      : ['queuePosition', 'session:queue:updated', 'session:request:error'];
  const content = asar
    .listPackage(asarPath)
    .filter((entry) => /^\\dist\\(?:main|renderer)\\/.test(entry) && /\.(?:js|html)$/.test(entry))
    .map((entry) => asar.extractFile(asarPath, entry.replace(/^\\/, '')).toString('utf8'))
    .join('\n');
  for (const marker of markers) {
    assert(content.includes(marker), `${application}: ASAR não contém ${marker}`);
  }
}

function authenticode(filePath) {
  if (process.platform !== 'win32') return { status: 'NotChecked', signer: null };
  const command = [
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:PROFESSOR_CONNECT_SIGNATURE_PATH',
    '[pscustomobject]@{',
    '  status = $signature.Status.ToString()',
    '  signer = if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject }',
    '} | ConvertTo-Json -Compress',
  ].join('\n');
  const output = execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      env: { ...process.env, PROFESSOR_CONNECT_SIGNATURE_PATH: filePath },
    },
  );
  return JSON.parse(output);
}

function renderMarkdown(report) {
  const rows = report.applications
    .map(
      (entry) =>
        `| ${entry.application} | ${entry.version} | \`${entry.gitSha}\` | ${entry.size} | \`${entry.sha256}\` | ${entry.signature.installer}/${entry.signature.application} |`,
    )
    .join('\n');
  return `# Desktop release report\n\nStatus: **${report.status}**  \nMode: **${report.mode}**  \nVersion: **${report.version}**  \nGit SHA: \`${report.gitSha}\`  \nGenerated: ${report.generatedAt}\n\n| App | Version | Git SHA | Size | SHA-256 | Signature installer/app |\n| --- | --- | --- | ---: | --- | --- |\n${rows}\n`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
