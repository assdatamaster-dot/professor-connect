import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = path.join(repositoryRoot, 'docker-compose.production.yml');
const isDryRun = process.argv.includes('--dry-run');
const envArgumentIndex = process.argv.indexOf('--env-file');
const envFileArgument = envArgumentIndex >= 0 ? process.argv[envArgumentIndex + 1] : undefined;
const envFile = path.resolve(repositoryRoot, envFileArgument ?? '.env.production');

if (!existsSync(composeFile)) {
  throw new Error(`Compose de produção não encontrado: ${composeFile}`);
}

if (!isDryRun && !existsSync(envFile)) {
  throw new Error(
    `Arquivo de ambiente não encontrado: ${envFile}. Copie .env.example para .env.production e revise os valores.`,
  );
}

const dockerArguments = [
  'compose',
  '--file',
  composeFile,
  '--env-file',
  envFile,
  'up',
  '--detach',
  '--build',
  '--remove-orphans',
  '--wait',
  '--wait-timeout',
  '120',
];

if (isDryRun) {
  console.log(`docker ${dockerArguments.join(' ')}`);
  process.exit(0);
}

const deployment = spawnSync('docker', dockerArguments, {
  cwd: repositoryRoot,
  stdio: 'inherit',
  shell: false,
});

if (deployment.error) {
  throw new Error(`Não foi possível executar o Docker: ${deployment.error.message}`);
}

if (deployment.status !== 0) {
  process.exit(deployment.status ?? 1);
}

console.log('Backend de produção publicado e saudável.');
