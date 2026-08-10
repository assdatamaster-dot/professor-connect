# Relatorio final - Fila, Presence e Auto Update

Data da auditoria: 2026-08-10

## 1. Causa raiz da fila

A causa original ja havia sido parcialmente corrigida nos commits `33fc308` e `a91a812`: o fluxo
antigo tratava `ProfessorAvailability.busy` como indisponibilidade terminal no cliente. A fila atual
preserva uma `SessionRequest` `PENDING`, define `queuedAt`, calcula FIFO no backend e permite
solicitar ao professor ocupado. A auditoria desta iteracao confirmou esse comportamento e manteve a
mesma entidade/fila.

Uma segunda falha foi corrigida: erros ao criar request eram apenas registrados no servidor. O aluno
nao recebia uma resposta distinta quando o professor tinha ficado offline. Agora
`session:request:error` usa `NO_PROFESSOR_ONLINE`; professor ocupado continua aceitando requests.

## 2. Causa raiz do Presence incompleto

`StudentPresenceManager` ja era a fonte autenticada usada pela API, fila e session, mas nao publicava
mudancas e o snapshot do Electron Teacher nao continha alunos online. O endpoint HTTP devolvia apenas
`id` e `name`. Assim, havia presence no backend, sem integracao operacional em tempo real.

Tambem havia remocao imediata em toda queda Socket.IO. A queda de transporte agora muda para
`reconnecting`; saida explicita continua offline imediata e heartbeat expirado remove o registro.

## 3. Arquivos alterados

- Student: `student-presence.controller.ts` e `apps/student-electron/package.json`;
- Teacher: controller, contracts, renderer HTML/TS/CSS, teste e package.json;
- API: composicao, controller/router de alunos online e teste;
- WebSocket: composicao, exports, Presence de aluno, Session manager/types, Request gateway e testes;
- release/docs: `package-lock.json`, `SPR-ATTENDANCE-QUEUE.md`,
  `SPR-ATTENDANCE-PRESENCE-OPERATIONAL.md` e este relatorio.

## 4. Backend

- `StudentPresenceManager.onChanged` publica snapshots autoritativos;
- registro por perfil substitui socket anterior e evita duplicidade;
- `online` e `reconnecting` sao diferenciados;
- socket reconectando nao e elegivel para promocao/inicio de session;
- `SessionManager.onSessionStarted` permite atualizar Presence no inicio exato da session.

## 5. Banco

Nenhuma tabela ou migration nova foi criada. Foram reutilizados `PresenceConnection`,
`SessionRequest`, `AttendanceSession` e a migration nova existente
`20260810120000_professor_attendance_queue`. Migrations historicas nao foram alteradas.

## 6. API

`GET /api/students/online` agora inclui conexao, estado de atendimento e timestamps. Quando
aplicavel, inclui fila/espera ou session/inicio. O filtro por `request.auth.organizationId` permanece
obrigatorio.

## 7. WebSocket

Eventos adicionados:

- `students:presence:get`;
- `students:presence:changed`;
- `session:request:error`.

O payload de Presence e enviado apenas a `TEACHER` com `students.online.read`, filtrado pela
organizacao. Request/session de outro professor nao e exposto no payload detalhado.

## 8. Aplicativo do aluno

- professor ocupado permanece selecionavel e aceita entrada na fila;
- posicao, quantidade a frente, tempo e estado do professor continuam em tempo real;
- `NO_PROFESSOR_ONLINE` volta ao estado idle com mensagem especifica;
- promocao continua exibindo `Sua vez chegou!` e inicia a session existente.

## 9. Aplicativo do professor

O snapshot passou a carregar `onlineStudents`. A interface mostra atendimento atual, fila e alunos
online, distinguindo disponivel, aguardando, em atendimento e reconectando. Posicao/tempo de espera e
duracao aparecem quando pertencem ao professor autenticado.

## 10. Fluxo da fila

Request ao professor `available` segue aceite manual. Request ao professor `busy` recebe `queuedAt`
e entra em FIFO. Fim da session chama o primeiro aluno online; os demais recebem novas posicoes.
Cancelamento remove a request e recalcula snapshots. Request persiste durante desconexao.

## 11. Fluxo de Presence

Login + Socket.IO + `student:register` cria presence online. Heartbeat atualiza `lastHeartbeat`.
Queda de transporte marca reconnecting; novo socket substitui o anterior. Saida explicita ou timeout
remove o aluno. Toda mudanca e combinada com fila/session e transmitida ao professor.

## 12. Estados

- conexao: `online`, `reconnecting`, offline por ausencia do snapshot;
- aluno: `available`, `waiting`, `in_attendance`;
- request: `pending`, `accepted`, `rejected`, `expired`, `cancelled`;
- session: ativa/finalizada e estados detalhados de recovery existentes.

## 13. Eventos WebSocket

Presence usa `students:presence:get` e `students:presence:changed`. Erros privados de request usam
`session:request:error`. A fila continua usando `session:queue:get`, `session:queue:updated`,
`session:queue:changed` e `session:queue:cleared`; o ciclo existente usa os eventos
`session:pending|requested|accepted|cancelled|timeout|rejected|started|ended`.

## 14. Testes executados

- `npm run check`: lint, typecheck, testes e format check;
- suites direcionadas WebSocket/API/Teacher/Student;
- concorrencia deterministica, FIFO, cancelamento, promocao e recovery existentes;
- teste novo de transicao disponivel -> aguardando -> em atendimento;
- teste novo de isolamento Socket.IO por organizacao;
- teste novo de ausencia de professor;
- teste de reconnecting/heartbeat;
- `npm run prisma:generate` e `npm run prisma:validate`;
- `npm run build-all`, `npm run updates:verify`, `npm run updates:stage`;
- auditoria Authenticode, manifests, provider e conteudo ASAR.

## 15. Resultados

`npm run check` passou: 15 workspaces no lint/typecheck, 18 tarefas de teste e Prettier. O WebSocket
executou 31 testes na suite direcionada; API 28; Teacher 15; Student 33. Prisma generate e validate
passaram. `prisma migrate status` nao foi executado contra banco porque `DATABASE_URL`, Docker e
PostgreSQL local nao estao disponiveis.

## 16. Versao anterior

Versao anterior publicada nos manifests locais: Student 0.1.1 e Teacher 0.1.1.

## 17. Nova versao

Nova versao: Student 0.1.2 e Teacher 0.1.2.

## 18. Build

`npm run build-all` concluiu os dois workspaces e o electron-builder gerou NSIS x64 e blockmaps sem
erro.

## 19. Auto Update

Os pacotes ASAR dos dois apps contem `@professor-connect/update-manager`; `app-update.yml` aponta
para `/updates/student` e `/updates/teacher`; o manager inicia em app empacotado, registra logs,
audita eventos e impede instalacao durante atendimento. `updates:verify` e `updates:stage` passaram.

Limitacao: os instaladores 0.1.1 e 0.1.2 estao `NotSigned`. E necessario configurar code signing de
producao e gerar os artefatos novamente antes de publicar. Download/install/restart real depende de
canal de homologacao publicado e maquina 0.1.1.

## 20. Artefatos gerados

- Student installer: `Professor-Connect-Aluno-Setup-0.1.2-x64.exe`, 100980450 bytes;
- Student blockmap e `latest.yml`/`beta.yml`/`alpha.yml`;
- Teacher installer: `Professor-Connect-Professor-Setup-0.1.2-x64.exe`, 100484409 bytes;
- Teacher blockmap e `latest.yml`/`beta.yml`/`alpha.yml`;
- arquivos preparados em `release-updates/student` e `release-updates/teacher`.

SHA-512 dos manifests foi validado pelo script oficial.

## 21. Procedimento de publicacao no EasyPanel

1. Fazer snapshot do PostgreSQL.
2. Configurar `DATABASE_URL` e manter uma replica do backend.
3. Publicar a imagem; o entrypoint executa `prisma migrate deploy`.
4. Confirmar a migration da fila e executar `prisma migrate status` contra o banco alvo.
5. Validar `/health`, login e o E2E P/A/B/C.
6. Depois de assinar/rebuildar, copiar `release-updates` para as URLs generic.
7. Publicar metadados pela API administrativa somente com autorizacao.

## 22. Procedimento para validar a atualizacao

Em uma maquina com 0.1.1: abrir o app, conferir log do update, verificar deteccao 0.1.2, download e
SHA-512, confirmar que nao instala durante atendimento, encerrar atendimento, instalar/reiniciar,
conferir `app.getVersion() = 0.1.2` e o evento `installation_healthy`.

## 23. Possiveis problemas restantes

- configurar certificado Authenticode e rebuildar;
- executar `prisma migrate status` no banco de homologacao/producao autorizado;
- publicar em homologacao e validar update real 0.1.1 -> 0.1.2;
- a coordenacao entre varias replicas continua fora do manager em memoria; o deploy deve manter uma
  replica ate existir adapter distribuido Socket.IO/lock transacional;
- QA visual automatizado no navegador embutido ficou bloqueado pela politica de sandbox do ambiente;
  renderer, ESM, typecheck e build Electron passaram.

## 24. Commit sugerido

`feat(attendance): integrate student presence with queue operations`
