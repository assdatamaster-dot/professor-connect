# Auditoria e implementação do pipeline automático de release

Data da auditoria: 2026-08-10  
Versão do código: 0.1.3  
Commit de base: `63922cf1ed450d8b2a3fd37ffe1c13c0440fc306`  
Estado geral: **IMPLEMENTADO LOCALMENTE; QA NO GITHUB E RELEASE REAL PENDENTES**

## Resultado da auditoria inicial

O monorepo já possuía os builds `build-all`, o `electron-updater` com provider HTTP genérico,
manifestação por canal, staging local, diagnóstico e rotas estáticas no backend. Teacher e Student
apontam, respectivamente, para:

- `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/teacher`;
- `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/student`.

Não havia `.github/workflows`, upload automático, armazenamento persistente configurado no
repositório, assinatura, promoção atômica nem rollback. `release/` e `release-updates/` estavam
corretamente ignorados pelo Git. A auditoria detalhada da instalação, ASAR, hashes e updater está
em [SPR-RELEASE-AUTO-UPDATE-AUDIT.md](./SPR-RELEASE-AUTO-UPDATE-AUDIT.md).

## Decisão arquitetural

**Problema:** os clientes existentes consultam `/updates/<app>`, mas o deploy Git do EasyPanel não
leva binários ignorados e não havia um publicador.

**Opções:** mudar o provider para GitHub Releases, usar object storage, publicar no volume
persistente do EasyPanel ou criar um serviço novo.

**Opção escolhida:** runner Windows do GitHub Actions + Artifact de QA + release oficial por tag
protegida + SSH com host key fixada + volume persistente do EasyPanel.

**Motivo:** preserva exatamente o provider/URL já embarcado nas versões instaladas e elimina a
cópia manual sem atribuir o build Windows ao EasyPanel.

**Impacto:** a configuração inicial do volume, environment, secrets, certificado e chave SSH é
obrigatória uma vez. Depois disso, cada tag aprovada faz build, assinatura, promoção, validação
e registro auditável automaticamente.

## Pipeline implementado

### CI/QA

- gatilhos: PR, qualquer push e `workflow_dispatch`;
- runner `windows-latest`, Node 22.12.0, `npm ci` com cache;
- Prisma validado com URL sintética e sem conexão PostgreSQL;
- lint, typecheck, testes e Prettier;
- build Teacher/Student NSIS x64 reutilizando `npm run build-all`;
- validação de versão, Git SHA, dirty, target, arquitetura, ASAR, tamanho e hashes;
- staging e relatório;
- Artifact do GitHub por 14 dias;
- nenhum secret e nenhuma publicação de produção.

### Release oficial

- único gatilho de publicação: tag exata `v<versão>`;
- environment `desktop-production`, que deve receber aprovação obrigatória no GitHub;
- preflight do `/api/health` sem realizar deploy do backend;
- PFX obrigatório por `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`;
- Authenticode `Valid` obrigatório no instalador e executável interno;
- Artifact assinado preservado por 30 dias antes da promoção;
- upload por SCP com chave dedicada e `known_hosts` fixado;
- SHA-256 do pacote validado no host;
- validação de ambos os feeds em staging;
- promoção atômica pela troca do link `.current`;
- download remoto completo e comparação SHA-256;
- rollback automático para previous quando a validação pós-publicação falha;
- criação do GitHub Release somente depois do servidor aprovado.

## Arquivos principais

Criados:

- `.github/workflows/desktop-release.yml`;
- `scripts/validate-prisma-schema.mjs`;
- `scripts/validate-release-context.mjs`;
- `scripts/validate-windows-release.mjs`;
- `scripts/promote-update-release.sh`;
- `scripts/rollback-update-release.sh`;
- `docs/deploy/release-pipeline.md`.

Alterados nesta etapa:

- `package.json` e `package-lock.json`;
- `scripts/diagnose-updates.mjs`;
- `services/backend/api/tests/health.spec.ts`;
- `docs/deploy/windows.md`;
- `docs/deploy/auto-update.md`;
- `docs/deploy/easypanel.md`;
- `docker-compose.production.yml`.

Os arquivos de identidade, health, updater e staging listados na auditoria anterior também fazem
parte do conjunto ainda não commitado que sustenta este pipeline.

## Evidências locais

| Verificação                         | Resultado                                                    |
| ----------------------------------- | ------------------------------------------------------------ |
| `npm run prisma:validate` sem banco | PASS                                                         |
| `npm run check`                     | PASS; 15 lint, 15 typecheck e 18 tasks de teste              |
| API                                 | PASS; 28/28, incluindo health e cache de updates             |
| Update Manager                      | PASS; 10/10                                                  |
| Teacher                             | PASS; 15/15                                                  |
| Student                             | PASS; 33/33                                                  |
| sintaxe dos scripts POSIX           | PASS com Git `sh -n`                                         |
| formatação e `git diff --check`     | PASS                                                         |
| `npm audit --omit=dev`              | PASS; 0 vulnerabilidades após atualizar `js-yaml` para 4.3.1 |
| trava de worktree dirty             | PASS: release recusada                                       |
| trava de `release-info` dirty       | PASS: verify/stage recusados                                 |
| assinatura local Teacher/Student    | `NotSigned`; produção corretamente bloqueada                 |

Artefatos locais auditados, somente QA e não publicáveis:

| App     | Versão/build          |   Tamanho | SHA-256                                                            |
| ------- | --------------------- | --------: | ------------------------------------------------------------------ |
| Teacher | `0.1.3+63922cf.dirty` | 100486844 | `859cbca829a99b852cf33d15e3ef31de3295900ae6d60cee8efd97e1897bd690` |
| Student | `0.1.3+63922cf.dirty` | 100985162 | `cd5429b6e44ba0b0accff7e0411ddb296f9233287518192366a5ed6898f89fe3` |

## Estado remoto observado

Leitura sem cache em 2026-08-10, sem qualquer mutação:

| Endpoint                      | HTTP | Observação                                        |
| ----------------------------- | ---: | ------------------------------------------------- |
| `/health`                     |  200 | responde apenas `{"status":"ok"}`; backend antigo |
| `/api/health`                 |  404 | identidade nova ainda não implantada              |
| `/updates/teacher/latest.yml` |  500 | volume/release ainda não configurado              |
| `/updates/student/latest.yml` |  500 | volume/release ainda não configurado              |

Logo, nenhum critério externo de publicação ou update A → B foi declarado como aprovado.

## Pendências obrigatórias

1. revisar e commitar o conjunto completo;
2. fazer push e observar o primeiro workflow QA real;
3. implantar o backend versionado que oferece `/api/health` e 404 correto para updates ausentes;
4. criar o volume persistente e validar o layout/symlinks em staging;
5. configurar environment, reviewers, secrets, retenção, certificado e chave restrita;
6. produzir uma tag beta nova e aprovar uma publicação somente após confirmação do responsável;
7. executar Teacher e Student A → B em VM, comprovando download, instalação, restart, versão,
   Git SHA e preservação de `%APPDATA%`;
8. somente depois testar `/health`, `/api/health`, autenticação, WebSocket e a fila completa com
   três alunos.

Docker não está instalado nesta estação; a imagem de produção não foi reconstruída aqui. O
workflow GitHub ainda não pode ser executado enquanto os arquivos não forem commitados/enviados.
Nenhum secret foi recebido, nenhuma tag foi criada e nada foi publicado ou alterado no EasyPanel.

## Commit sugerido

`feat(release): automatizar build assinado e promoção atômica dos desktops`

## Próxima ação manual necessária

Revisar este diff e autorizar o commit/push de QA. Em paralelo, preparar o volume e o environment
`desktop-production` sem ainda criar uma tag oficial.
