# Scripts

Diretório da raiz reservado para automações repetíveis de desenvolvimento e operação do monorepo.
Scripts devem ser idempotentes, documentados, falhar de forma explícita e não importar regras de
negócio de `apps`, `packages` ou `services`.

## Produção

`deploy-production.mjs` executa o Compose de produção com build, remoção de serviços órfãos e
espera pelo health check. Ele exige `.env.production` por padrão e aceita
`--env-file <caminho>` ou `--dry-run`.

Os builds Windows são expostos como scripts npm na raiz: `build-student`, `build-teacher` e
`build-all`. Consulte `docs/deploy/windows.md`.
