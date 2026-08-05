#!/bin/sh
set -eu

node <<'NODE'
const value = process.env.DATABASE_URL;
if (value === undefined || value.trim() === '') {
  throw new Error('DATABASE_URL é obrigatória para iniciar o backend.');
}

const target = new URL(value);
if (target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') {
  throw new Error(`DATABASE_URL deve usar PostgreSQL; protocolo recebido: ${target.protocol}`);
}

const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (databaseName === '') {
  throw new Error('DATABASE_URL deve informar explicitamente o nome do banco PostgreSQL.');
}

console.info(
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    origin: 'database-entrypoint',
    event: 'Destino PostgreSQL configurado',
    data: {
      host: target.hostname,
      port: target.port || '5432',
      databaseName,
      schemaName: target.searchParams.get('schema') || 'public',
    },
  }),
);
NODE

npm run backend:prepare
exec "$@"
