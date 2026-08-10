import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaCli = path.join(repository, 'node_modules', 'prisma', 'build', 'index.js');
const schema = path.join(repository, 'services', 'backend', 'database', 'prisma', 'schema.prisma');

execFileSync(process.execPath, [prismaCli, 'validate', '--schema', schema], {
  cwd: repository,
  env: {
    ...process.env,
    DATABASE_URL:
      process.env.DATABASE_URL ??
      'postgresql://schema_validation:schema_validation@127.0.0.1:5432/professor_connect',
  },
  stdio: 'inherit',
});
