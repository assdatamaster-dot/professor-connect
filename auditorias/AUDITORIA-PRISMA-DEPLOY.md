# Auditoria do deploy Prisma

## Diagnóstico

- Schema: `services/backend/database/prisma/schema.prisma`.
- Migrations: `services/backend/database/prisma/migrations` (cinco migrations PostgreSQL).
- A tabela `presence_connections` já é criada por
  `20260731091000_support_workflow/migration.sql`; não faltava uma migration de schema.
- Prisma Client: `@prisma/client` e CLI estão fixados em `6.19.3`; `postinstall`, `prebuild` e o
  Dockerfile já geravam o client corretamente.
- Causa do P2021: o Dockerfile aplicava migrations em seu `CMD`, mas o `npm run start` usado por
  Nixpacks ou por um override do EasyPanel iniciava diretamente `dist/server.js`.

## Correção implementada

`npm run backend:prepare` é agora o ponto único de preparação e executa, em ordem:

1. `prisma generate`;
2. `prisma migrate deploy`.

`npm run start`, `npm run dev`, Docker e Nixpacks usam esse fluxo. O servidor ainda executa uma
barreira defensiva: compara as pastas de migrations embarcadas com os registros concluídos em
`_prisma_migrations` antes de chamar `RecoveryRepository.recoverAfterRestart()`. Se o banco estiver
vazio, pendente ou com migration malsucedida, o processo falha fechado e não toca nas tabelas de
domínio.

O Turbo continua responsável apenas pelo build: migrations alteram estado externo e não devem ser
uma task cacheável. O Nixpacks foi limitado ao grafo do backend, e a imagem Docker inclui schema,
migrations e o `package.json` raiz necessário ao comando de preparação.

## Validações executadas

- `prisma validate`: schema válido;
- `prisma generate`: client 6.19.3 gerado;
- `prisma migrate diff --from-empty`: 21 tabelas esperadas, as mesmas 21 criadas pela cadeia de
  migrations, incluindo `presence_connections`;
- `npm run build-backend`: seis workspaces do backend compilados pelo Turbo;
- testes da barreira de inicialização: banco preparado aceito; tabela de controle ausente e
  migration pendente rejeitadas;
- `turbo prune @professor-connect/api --docker`: scripts de preparação e workspaces do banco
  presentes no monorepo reduzido;
- geração em runtime altera somente `node_modules/.prisma` (cerca de 25 MB neste host); o Compose
  reserva 64 MB de `tmpfs` para manter o root filesystem somente leitura;
- simulação com PostgreSQL indisponível: `backend:prepare` gerou o client, falhou em
  `migrate deploy` e não avançou para o servidor.

O lint e o typecheck completos passaram nos 13 workspaces. O check global permanece vermelho por
duas pendências anteriores e fora deste escopo: o teste
`websocket/tests/remote-control-channel.spec.ts` excede seu timeout também quando repetido
isoladamente, e o `format:check` aponta três JSONs já existentes em `auditorias/`. Os testes do
banco e da API passaram integralmente.

O host da auditoria não possui Docker nem uma instância PostgreSQL local; por isso, a construção da
imagem e a aplicação real das migrations em um servidor vazio devem ser confirmadas pelo primeiro
deploy/CI. A cadeia SQL e o comportamento de bloqueio foram validados estaticamente e por testes.

O Prisma 6.19.3 ainda aceita a configuração de seed em `package.json`, mas emite aviso de que esse
formato será removido no Prisma 7. Isso não interfere no deploy atual e deve ser tratado junto de
uma futura atualização major.

## Resultado esperado no primeiro deploy

`prisma migrate deploy` cria `_prisma_migrations`, aplica as cinco migrations em ordem e prepara
todas as tabelas, inclusive `public.presence_connections`. Só depois a recuperação pós-restart e o
listener HTTP são iniciados. Deploys posteriores reaplicam o fluxo de modo idempotente.
