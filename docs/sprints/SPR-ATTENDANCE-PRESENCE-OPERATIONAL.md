# Sprint - Presence operacional da fila

## Arquitetura auditada

O servidor possui duas camadas historicas de presence: a camada generica de workflow, usada pelo
protocolo de recovery, e os managers autenticados de produto `PresenceManager` e
`StudentPresenceManager`, usados por fila, API e aplicativos Electron. Esta sprint nao cria uma
terceira camada. A visao operacional reutiliza `StudentPresenceManager` e compoe seus dados com
`SessionRequestManager` e `SessionManager` somente na borda Socket.IO.

A fila continua sendo `SessionRequest.status = PENDING`, ordenada por `createdAt` e `requestId`. A
session continua sendo `AttendanceSession`. Consulte `SPR-ATTENDANCE-QUEUE.md` para o fluxo FIFO,
migration e constraints.

## Estados

| Conexao                       | Atendimento            | Exibicao do professor                                        |
| ----------------------------- | ---------------------- | ------------------------------------------------------------ |
| `online`                      | sem request ou session | Online / Disponivel                                          |
| `online`                      | request `pending`      | Aguardando, com posicao e tempo quando pertence ao professor |
| `online`                      | session ativa          | Em atendimento, com duracao quando pertence ao professor     |
| `reconnecting`                | qualquer estado acima  | Reconectando, preservando fila/session                       |
| removido por saida ou timeout | qualquer               | Offline; deixa a lista de alunos online                      |

Uma saida explicita (`student:disconnect`) marca offline imediatamente. Uma queda de transporte muda
o registro para `reconnecting`; ele so e removido quando o heartbeat expira. O socket antigo nao pode
ser usado para promover o aluno, pois `findStudentById` retorna somente conexoes realmente online. Ao
registrar um novo socket para o mesmo perfil, o registro antigo e substituido sem duplicar o aluno.

## Eventos Socket.IO

- `students:presence:get`: professor autenticado solicita o snapshot depois de conectar/reconectar;
- `students:presence:changed`: snapshot atualizado em registro, saida, timeout, reconexao,
  entrada/saida da fila e inicio/fim de atendimento;
- `session:request:error`: informa ao proprio aluno falhas de criacao. `NO_PROFESSOR_ONLINE`
  diferencia ausencia de professor conectado de professor ocupado;
- eventos de fila e session permanecem documentados em `SPR-ATTENDANCE-QUEUE.md`.

`students:presence:changed` e emitido somente para sockets `TEACHER` com
`students.online.read`, filtrado pelo `organizationId` autenticado. Alunos nunca recebem a lista de
outros alunos. Dados de request/session de outro professor nao sao incluidos; apenas o estado geral e
visivel dentro da organizacao.

## API

`GET /api/students/online` permanece protegido por JWT e `students.online.read`. A resposta, sempre
filtrada por organizacao, inclui `connectionStatus`, `attendanceStatus`, timestamps e, quando
aplicavel, posicao/espera ou inicio/session. O endpoint serve para recuperacao e auditoria; o Electron
usa Socket.IO, sem polling.

## Aplicativo do professor

A tela operacional possui atendimento atual, fila FIFO e alunos online. Os indicadores distinguem
disponivel, aguardando, em atendimento e reconectando. Durante uma chamada, fila e presence ficam em
um trilho compacto abaixo da midia. Em telas menores, o trilho volta para uma coluna.

## Auto Update e release 0.1.2

Os aplicativos 0.1.1 ja contem `@professor-connect/update-manager`, `electron-updater`, IPC,
interface de progresso, logs em `userData/update-manager/update.log`, canais stable/beta/development
e provider generic do EasyPanel. Assim, uma instalacao 0.1.1 valida pode receber 0.1.2 sem
reinstalacao manual. Instalacoes anteriores ao primeiro build com updater exigem uma unica
reinstalacao manual.

Fluxo de release:

1. `npm run check`;
2. `npm run prisma:generate`, `npm run prisma:validate` e `npm run prisma:status`;
3. `npm run build-all`;
4. `npm run updates:verify`;
5. `npm run updates:stage`;
6. publicar o backend no EasyPanel com uma replica; o entrypoint executa `prisma migrate deploy`;
7. publicar `release-updates/student/*` e `release-updates/teacher/*` nas URLs configuradas;
8. publicar metadados 0.1.2 pela API administrativa somente apos autorizacao;
9. validar check, download, hash, instalacao, restart e `installation_healthy` em uma maquina 0.1.1.

Nenhum comando desta sprint publica automaticamente em producao.

### Limitacao de assinatura

Os instaladores locais 0.1.1 e 0.1.2 foram auditados com `Get-AuthenticodeSignature` e estao
`NotSigned`. `electron-builder` gera os artefatos e manifests corretamente, mas nao existe
certificado de code signing configurado no ambiente. Antes da publicacao, configure um certificado
Windows confiavel e gere novamente os dois instaladores. A verificacao de hash/blockmap passou, mas
download, instalacao e restart reais nao podem ser declarados ponta a ponta sem publicar em um canal
de homologacao e instalar em uma maquina 0.1.1.
