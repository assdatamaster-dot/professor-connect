# Auditoria — Sprint Beta-12C

Data: 2026-08-06

## Resultado

- Update Manager independente: aprovado.
- Professor e Aluno: mesma implementação e mesmos contratos IPC.
- Electron Builder 26.15.3 / Electron Updater 6.8.9: compilação aprovada.
- NSIS x64: instaladores de Professor e Aluno gerados.
- Metadata: `latest.yml`, `beta.yml`, `alpha.yml` e blockmaps gerados e verificados.
- Provider: HTTP genérico compatível com Docker/EasyPanel; troca para GitHub/S3 é declarativa.
- Download silencioso, progresso, changelog e preferências: aprovados.
- Proteção de atendimento: instalação bloqueada e retomada após encerramento.
- Integridade: SHA-512 do updater e segunda verificação antes do cache de rollback.
- Rollback: instalador anterior preservado, verificado e acionado em falha de saúde.
- Banco/API/painel: releases, instalações, auditoria e métricas implementados.
- Logs: JSON lines local rotativo e eventos persistentes no PostgreSQL.

## Evidências automatizadas

- 9 testes do Update Manager aprovados.
- 4 testes dos endpoints/contratos de versão aprovados.
- Typecheck aprovado para API, painel, Update Manager, Professor e Aluno.
- Build Vite do painel aprovado.
- Build Electron dos dois clientes aprovado.
- Instaladores gerados com blockmap e YAML consistentes.
- `npm audit --omit=dev`: zero vulnerabilidades conhecidas.

## Assinatura

Os artefatos locais auditados estão `NotSigned`, porque nenhum certificado foi fornecido. Isso é o
estado esperado da preparação solicitada: configuração de verificação, NSIS e suporte a `CSC_LINK`
estão prontos. A promoção a produção fica condicionada a certificado Authenticode válido no CI.

## Limite do rollback

Falhas transacionais do NSIS preservam a instalação atual. O rollback explícito passa a ter uma
versão anterior disponível após a primeira atualização saudável gerenciada pelo módulo. Na primeira
instalação da vida útil ainda não existe instalador anterior para restaurar, portanto a atomicidade do
NSIS é a proteção aplicável.
