# Auditoria — Sprint Beta-11C

Data: 2026-08-05

## Resultado

A Sprint Beta-11C implementa o fluxo inteligente de atendimento entre aluno e professor sobre os
contratos autenticados existentes. Disponibilidade, solicitação, resposta, início, encerramento e
histórico são sincronizados sem atualização manual. Áudio, vídeo, compartilhamento de tela,
controle remoto e transferência de arquivos permanecem integrados à sessão WebRTC já existente.

A revisão não encontrou regressões automatizadas. Os dois instaladores Windows foram regenerados e
o conteúdo dos respectivos arquivos ASAR foi conferido para confirmar a presença do Beta-11C.

## Arquitetura e domínio

- A disponibilidade pertence ao `PresenceManager`, é persistida pelo repositório Prisma e publicada
  pelo `ProfessorPresenceGateway`.
- A solicitação direcionada pertence ao `SessionRequestManager`; somente o aluno solicitante pode
  cancelá-la e somente o professor escolhido pode aceitar ou recusar.
- O professor é reservado como `BUSY` ao receber uma solicitação, evitando duas filas simultâneas e
  retirando-o imediatamente da lista dos demais alunos.
- Recusa, cancelamento e expiração restauram `AVAILABLE`; aceite mantém `BUSY` até o encerramento.
- O `SessionManager` registra início, fim, duração inteira em segundos e motivo. Um índice por
  `requestId` permite compor o histórico sem varrer as sessões.
- Listas e respostas são isoladas por `organizationId`; eventos sensíveis exigem identidade, role e
  permission no socket autenticado.
- O renderer não abre novas conexões para a lista: reutiliza o Socket.IO do controller. Listeners,
  heartbeat, relógio de sessão e timer do tempo disponível possuem cleanup explícito.

## Prisma e recuperação

A migration `20260805150000_intelligent_attendance_flow` cria o enum `ProfessorAvailability`, as
colunas `availability` e `available_since`, e o índice institucional de disponibilidade. O default
é `UNAVAILABLE`, impedindo que um processo reiniciado anuncie professores sem conexão ativa.

Na recuperação, presenças anteriores são encerradas, professores ficam indisponíveis, solicitações
pendentes expiram e sessões ativas passam a `INTERRUPTED` com fim, duração e motivo
`server-restart`.

## Segurança, performance e erros

- Disponibilidade só pode ser alterada por `TEACHER` com `session.respond`.
- Solicitações validam presença, disponibilidade, participante, instituição e duplicidade.
- O histórico HTTP usa JWT e filtra pela identidade do aluno/professor.
- O gateway publica apenas professores disponíveis da mesma instituição.
- A emissão duplicada de `professor:availability:changed` foi removida durante a auditoria.
- Persistência continua serializada pela fila existente, preservando a ordem entre request,
  disponibilidade, sessão e eventos de domínio.
- Avatares remotos são aceitos pela CSP somente em `https:`; quando ausentes ou inválidos, a
  interface usa iniciais sem quebrar o cartão.
- Erros de domínio retornam mensagens operacionais; tokens e dados sensíveis não entram nos novos
  payloads ou logs.

## UX revisada

- Professor: status disponível/indisponível no cabeçalho, reserva visual, modal imediato de
  solicitação, histórico e controles ativos durante a sessão.
- Aluno: cartões com foto/iniciais, nome, indicador online e tempo disponível; confirmação antes da
  solicitação; cancelamento enquanto aguarda; feedback de aceite, recusa, timeout e encerramento.
- O tempo disponível é recalculado uma vez por minuto sem consultar o servidor.
- O aceite inicia a sessão e o WebRTC automaticamente; mídia é preparada pelo fluxo já usado pelos
  aplicativos, respeitando as permissões do sistema operacional.

## Evidências automatizadas

- `npm run check`: aprovado em 14 workspaces.
- Testes: 142 aprovados, zero falhas, em 16 tarefas Turbo.
- Teste integrado confirma mudança de disponibilidade, lista em tempo real, reserva `BUSY`, aceite,
  recusa, timeout, WebRTC, compartilhamento e encerramento.
- `npm run build`: 14/14 workspaces compilados.
- `npm run prisma:validate`: schema válido.
- `npm audit --audit-level=moderate`: zero vulnerabilidades.
- `npm run build-all`: dois pacotes NSIS x64 gerados.
- `git diff --check` e Prettier: aprovados.

## Executáveis atualizados

| Aplicativo            |           Tamanho | SHA-256                                                            |
| --------------------- | ----------------: | ------------------------------------------------------------------ |
| Aluno `0.1.0-x64`     | 100.561.972 bytes | `CD18996F4D1CC97845868515240D876D8C71F5BBF4CC17DF65791E4E3FBCE340` |
| Professor `0.1.0-x64` | 100.064.936 bytes | `745DB76D6315EC8D6AEFC0DBF6A2E08724667A0CC9D1D0EDACD3E791246E05C1` |

Os instaladores foram gerados em `release/student` e `release/teacher`. O conteúdo ASAR do aluno
contém lista em tempo real e cancelamento; o do professor contém disponibilidade e histórico.

## Limitações e ações operacionais

- Este host não possui Docker nem `psql`. A migration foi validada pelo Prisma e por teste
  estrutural, mas deve ser aplicada e validada contra o PostgreSQL de homologação com
  `npm run prisma:deploy` antes da publicação.
- O navegador integrado recusou a sessão por falta do metadado de ambiente `sandboxPolicy`. A
  validação visual automatizada não foi contornada; HTML, CSS e estados foram cobertos por testes de
  UI, lint, tipagem, build Electron e revisão estática.
- Os instaladores estão tecnicamente válidos, porém `Get-AuthenticodeSignature` retorna
  `NotSigned`. Para distribuição pública sem alerta do Windows SmartScreen, a operação de release
  precisa configurar um certificado de code signing no `electron-builder` e regenerar os pacotes.
