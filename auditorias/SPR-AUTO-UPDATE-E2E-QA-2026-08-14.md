# Auditoria end-to-end do Auto Update — 2026-08-14

## Resultado executivo

O pipeline local de QA, os dois instaladores, os manifests e o download pelo `electron-updater`
real foram validados. O ciclo instalado `A -> B` ainda não pode ser declarado end-to-end: os dois
feeds remotos retornam `404`, não há credencial SSH disponível neste ambiente para inspecionar o
mount remoto e não foi usada uma VM descartável para executar a instalação/reinício.

Nenhuma tag, publicação, promoção, rollback, alteração de banco, secret ou release oficial foi
realizada.

## Causa raiz

### Bloqueio operacional do cliente

O primeiro ponto remoto de falha é a ausência dos manifests no caminho servido pelo backend:

| Recurso                       | Resultado em 2026-08-14                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `/updates/teacher/latest.yml` | `404`, JSON de 73 bytes, `Cache-Control: no-store`, sem redirect |
| `/updates/student/latest.yml` | `404`, JSON de 73 bytes, `Cache-Control: no-store`, sem redirect |
| `/api/health`                 | `200`, versão `0.1.3`, `gitSha: unknown`, `buildDate: unknown`   |

O `404 update_artifact_not_found` prova que a rota atual do backend está ativa, mas o processo não
encontra `teacher/latest.yml` nem `student/latest.yml` em `UPDATE_ARTIFACTS_PATH`. Sem acesso SSH ao
host/container, não é possível distinguir por inspeção direta entre mount vazio, mount ausente e
arquivos colocados em outro caminho. Em todos os casos, o efeito para os clientes é o mesmo: o
`electron-updater` para antes de interpretar uma versão ou descobrir o instalador.

### Falhas comprovadas no pipeline de QA

1. `scripts/validate-windows-release.mjs` construía um comando PowerShell inválido e também assumia
   que um argumento após `-Command` estaria disponível em `$args[0]`. O job falhava ao consultar
   Authenticode mesmo em QA unsigned.
2. O workflow define um único `BUILD_DATE`, mas o modo estrito do Turborepo removia essa variável do
   ambiente dos builds. Teacher e Student recebiam datas diferentes.

## Correções

| Arquivo                                | Alteração                                                                                                  | Motivo                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `scripts/validate-windows-release.mjs` | preserva as quebras de linha do script PowerShell e passa o caminho por `PROFESSOR_CONNECT_SIGNATURE_PATH` | executar `Get-AuthenticodeSignature` com segurança, inclusive em caminhos com espaços, e permitir QA `NotSigned` |
| `turbo.json`                           | inclui `BUILD_DATE` em `globalEnv`                                                                         | entregar a data definida pelo workflow aos dois builds e incluí-la no hash do cache                              |

Não houve mudança no Update Manager, nos clientes, no backend de negócio, na interface, no banco ou
na infraestrutura remota.

## Fluxo real

Teacher e Student usam a mesma implementação. A diferença é a aplicação e o diretório do feed.

| Etapa               | Teacher                                                                                       | Student                                                                       | Entrada                                                | Saída                                        | Falha possível                                     |
| ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- | -------------------------------------------------- |
| Composição          | `apps/teacher-electron/main/index.ts`, `createWindow`, `application: teacher`                 | `apps/student-electron/main/index.ts`, `createWindow`, `application: student` | `app.getVersion()`, `config.json`, `app.isPackaged`    | `UpdateManager` inicializado                 | identidade/version divergente; app não empacotado  |
| URL efetiva         | `resources/app-update.yml`, gerado de `build.publish` em `apps/teacher-electron/package.json` | equivalente Student                                                           | provider generic                                       | `/updates/teacher` ou `/updates/student`     | URL embutida incorreta                             |
| Agendamento         | `UpdateManager.start`                                                                         | mesmo                                                                         | preferências, canal e estado de rollback               | timer inicial e periódico                    | settings inválidas; recuperação pendente           |
| Consulta            | `UpdateManager.check` -> `UpdateChecker.check` -> `autoUpdater.checkForUpdates`               | mesmo                                                                         | versão instalada e canal (`latest`, `beta` ou `alpha`) | GET do YAML                                  | HTTP, redirect, HTML, YAML inválido                |
| Comparação          | `electron-updater`                                                                            | mesmo                                                                         | versão instalada e `version` do YAML                   | `update-available` ou `update-not-available` | versão não superior, prerelease/canal incompatível |
| Download            | `UpdateManager.download` -> `DownloadManager.download`                                        | mesmo                                                                         | `files[].url`, tamanho e SHA-512                       | instalador no cache do updater               | arquivo ausente, rede, tamanho/hash divergente     |
| Validação adicional | `UpdateManager.onDownloaded` -> `RollbackManager.prepareCandidate`                            | mesmo                                                                         | arquivo baixado e SHA-512                              | candidato preservado para rollback           | arquivo inválido ou SHA-512 divergente             |
| Instalação          | `UpdateManager.install` -> `InstallManager.install`                                           | mesmo                                                                         | update baixado e nenhum atendimento ativo              | `quitAndInstall(true, true)`                 | atendimento ativo, NSIS/ACL/antivírus              |
| Reinício/saúde      | NSIS + `RollbackManager.handleStartup`                                                        | mesmo                                                                         | nova instalação e estado em `userData`                 | versão B ativa ou rollback após falhas       | app não inicia; três inicializações não saudáveis  |

URLs atuais:

- Teacher: `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/teacher/latest.yml`;
- Student: `https://professorconnect-professoread.lwf5hh.easypanel.host/updates/student/latest.yml`.

O campo `updateUrl` passado pelo `main/index.ts` alimenta estado e logs. A fonte usada internamente
pelo `electron-updater` é `resources/app-update.yml`, criada pelo Electron Builder; hoje as duas
fontes coincidem.

## Logs

`UpdateFileLogger` grava JSON Lines rotativo em
`%APPDATA%/<produto>/update-manager/update.log`. O `UpdateManager` registra com prefixo `[UPDATE]` a
versão atual, app, identidade do build, feed/canal, início da consulta, versão encontrada ou
ausente, início/fim do download, validação de integridade, instalação/reinício e erros. Como o mesmo
logger é atribuído ao `electron-updater`, suas mensagens acrescentam a URL resolvida do artefato e
os detalhes HTTP em caso de erro. Tokens, Authorization, senhas, secrets e credenciais em URL são
redigidos antes da persistência.

O `electron-updater` não expõe evento com o status HTTP de uma resposta bem-sucedida; nesse caso,
`update-available`/`update-not-available` é a evidência do sucesso da consulta. O status numérico,
headers e redirects são cobertos por `updates:diagnose`. Não foi adicionada uma segunda requisição
HTTP ao cliente apenas para duplicar esse diagnóstico.

## Geração, stage, publicação e volume

1. `npm run build-all` chama `electron-builder --win nsis --x64` para cada aplicativo.
2. O Electron Builder gera o instalador, `.blockmap`, `latest.yml`, `beta.yml`, `alpha.yml` e
   `resources/app-update.yml` a partir de `build.publish`.
3. `write-release-info.mjs` calcula SHA-256/SHA-512, tamanho, arquitetura, target e identidade.
4. `updates:verify` valida o conjunto em `release/{teacher,student}`.
5. `updates:stage` copia somente o conjunto aprovado para `release-updates/{teacher,student}`.
6. Em QA, o workflow apenas guarda `release-updates/` como GitHub Artifact; ele não publica no
   EasyPanel.
7. Em tag oficial, o workflow empacota o payload e usa SSH. `promote-update-release.sh` valida em
   `.staging`, move para `.releases/<versao>-<sha>`, troca `.current` atomicamente e mantém os links
   públicos `teacher -> .current/teacher` e `student -> .current/student`.
8. O backend monta o volume como `/app/release-updates` e o serve com
   `express.static(environment.updateArtifactsPath)` sob `/updates`.

O caminho informado para o volume no host é
`/etc/easypanel/projects/professorconnect/professoread/volumes/windows-updates`; ele não foi lido ou
alterado nesta execução porque não existem `UPDATE_DEPLOY_*`, chave privada ou alias SSH local.

## QA controlado executado

A versão B foi reconstruída no Windows a partir do HEAD limpo `8e0a75e`, sem certificado:

| App     | Versão  | NSIS/x64 |     Tamanho | SHA-256                                                            | Authenticode         |
| ------- | ------- | -------- | ----------: | ------------------------------------------------------------------ | -------------------- |
| Teacher | `0.1.3` | PASS     | `100486777` | `3324640acbc95eb2f2a260c29d2a2ad38c73fa3c2e1924aa79f5b6ad619c3846` | `NotSigned` esperado |
| Student | `0.1.3` | PASS     | `100985235` | `56a4bdd772ff5142a865ee9f2675d22463320c22de91d8a0b450172b733d6ade` | `NotSigned` esperado |

Esses artefatos limpos foram gerados imediatamente antes das duas correções de pipeline e, por
isso, ainda registram horários de build diferentes. Um build TS direcionado depois da correção
confirmou `2026-08-14T20:00:00.000Z` nos dois `build-info.json`; como o worktree já estava alterado,
ele ficou corretamente marcado `dirty` e não substituiu o conjunto staged. O próximo build limpo no
CI deve recriar os instaladores com a data única.

Um harness efêmero, sem alteração de arquivos-fonte, executou o `NsisUpdater` real com versão atual
simulada `0.1.1`, servidor HTTP local e os manifests/instaladores acima. Para ambos os produtos ele:

1. solicitou `latest.yml`;
2. detectou `0.1.3` como superior a `0.1.1`;
3. solicitou o `.exe` indicado;
4. baixou o arquivo completo;
5. confirmou o SHA-512 do manifest.

O harness não executou `quitAndInstall`; portanto não prova NSIS, reinício ou versão ativa.

## Testes

| Teste                                    | Resultado                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Check                                    | PASS                                                                         |
| Lint                                     | PASS — 15 workspaces                                                         |
| Typecheck                                | PASS — 15 workspaces                                                         |
| API                                      | PASS — 28/28                                                                 |
| Student                                  | PASS — 33/33                                                                 |
| Teacher                                  | PASS — 15/15                                                                 |
| Update Manager                           | PASS — 10/10                                                                 |
| Build                                    | PASS — Teacher e Student NSIS x64                                            |
| `updates:verify`                         | PASS                                                                         |
| `updates:stage`                          | PASS                                                                         |
| validação de release QA/ASAR             | PASS                                                                         |
| `latest.yml` Teacher local               | PASS                                                                         |
| `latest.yml` Student local               | PASS                                                                         |
| `latest.yml` Teacher remoto              | FAIL — HTTP 404                                                              |
| `latest.yml` Student remoto              | FAIL — HTTP 404                                                              |
| Download Teacher local pelo updater real | PASS — SHA-512                                                               |
| Download Student local pelo updater real | PASS — SHA-512                                                               |
| Download Teacher remoto                  | BLOCKED — manifest ausente                                                   |
| Download Student remoto                  | BLOCKED — manifest ausente                                                   |
| Update `0.1.1 -> 0.1.3`                  | PARTIAL — detecção/download íntegro PASS; instalação/reinício não executados |

## Pendências reais

1. Inspecionar, sem escrever, `/app/release-updates` no container e o volume correspondente no host.
2. Criar/copiar o payload para `qa/teacher` e `qa/student`, sem alterar `.current` ou os diretórios
   públicos, usando uma credencial autorizada.
3. Em VM descartável, apontar `resources/app-update.yml` da versão A para o feed QA, executar
   Teacher e Student separadamente e registrar detecção, download, NSIS, reinício e versão B.
4. Fazer o backend expor `GIT_SHA` e `BUILD_DATE` reais; hoje ambos são `unknown` e o diagnóstico
   remoto recusa corretamente essa identidade.

## Próximo passo para a primeira release oficial

Primeiro conclua o roteiro de VM acima no feed QA. Depois incremente e sincronize a próxima versão
SemVer nos quatro `package.json` e no lockfile, configure Authenticode e os secrets do environment
`desktop-production`, publique o backend com identidade válida e somente então crie a tag oficial.
O job de tag fará build limpo/assinado, promoção atômica, download remoto com hash e rollback em caso
de divergência.
