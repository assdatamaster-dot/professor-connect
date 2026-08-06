import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';
const target = fileURLToPath(
  new URL(
    isProduction ? './dist/migration-recovery-cli.js' : './src/migration-recovery-cli.ts',
    import.meta.url,
  ),
);
const arguments_ = isProduction ? [target] : ['--import', 'tsx', target];

const child = spawn(process.execPath, arguments_, {
  env: process.env,
  stdio: 'inherit',
});

child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
