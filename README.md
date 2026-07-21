# Professor Connect

O Professor Connect é uma plataforma planejada para aproximar alunos e professores em
atendimentos remotos. Este repositório contém a fundação técnica do produto: organização do
monorepo, limites entre módulos, ferramentas de qualidade e documentação para orientar a
evolução do sistema.

> **Estado atual:** MVP-3 — fluxo de atendimento integrado entre as aplicações Electron, backend,
> Workflow, signaling, WebRTC, mídia e compartilhamento de tela. O monorepo permanece organizado em
> `apps`, `packages` e `services/backend`.

## Arquitetura

O projeto adota monorepo com separação explícita entre clientes desktop, módulos de backend e
pacotes compartilhados. A arquitetura pretendida segue Clean Architecture:

```text
Aplicativos desktop
        │
        ├── API (requisição/resposta)
        └── WebSocket (eventos em tempo real)
                         │
                   Serviços de aplicação
                         │
                  Camada de persistência
                         │
                      PostgreSQL
```

As dependências devem apontar das camadas externas para contratos internos. Regras de negócio
não devem depender de Tauri, Socket.IO, Prisma ou detalhes de infraestrutura. Tipos, utilitários
e elementos visuais realmente reutilizáveis ficam em `packages/`.

## Tecnologias

- **Turborepo:** orquestração de tarefas, cache e dependências entre workspaces.
- **TypeScript e Node.js:** linguagem e ambiente de execução dos módulos.
- **Electron:** interfaces desktop executáveis de aluno e professor, com renderer isolado e sandbox.
- **Tauri:** estrutura anterior preservada nos workspaces de composição existentes.
- **Express:** servidor HTTP e fronteira da API.
- **Socket.IO:** comunicação tipada para ping/pong, sessões, presença, solicitações, Calls e
  mensagens de negociação do servidor de sinalização.
- **WebRTC:** conexão peer-to-peer por DataChannel, áudio e vídeo nos clientes desktop, com APIs
  nativas do renderer Chromium/Electron ou WebView e implementação Node somente nos testes.
- **Prisma:** cliente configurado para a futura persistência PostgreSQL, ainda sem modelos.
- **ESLint, Prettier e EditorConfig:** análise estática e padronização do código.

Nesta sprint, o backend continua expondo somente `GET /health` via HTTP e transportando a
sinalização pelo Socket.IO. Peers, DataChannel e MediaStreams ficam exclusivamente nos clientes
por meio do workspace compartilhado `@professor-connect/engine`. `STUDENT` e `TEACHER` continuam
sendo papéis técnicos sem login. O Prisma permanece sem modelos, migrações ou acesso ao banco.

## Estrutura de pastas

```text
ProfessorConnect/
├── apps/
│   ├── student-desktop/   # Composição Tauri preservada do aluno
│   ├── student-electron/  # Aplicação Electron do aluno
│   ├── teacher-desktop/   # Composição Tauri preservada do professor
│   └── teacher-electron/  # Aplicação Electron do professor
├── packages/
│   ├── engine/            # WebRTC, mídia, DataChannel, Workflow e integração E2E
│   ├── protocol/          # EventType, SocketMessage e payloads compartilhados
│   ├── shared/            # Utilitários agnósticos
│   └── ui/                # Base visual compartilhada
├── services/
│   └── backend/
│       ├── api/           # Servidor Express e composição HTTP
│       ├── config/        # Variáveis de ambiente validadas
│       ├── database/      # Prisma e futura persistência
│       ├── services/      # Casos de uso, stores e State Machines
│       └── websocket/     # Socket.IO, comunicação e signaling
├── docs/                  # Guias e planejamento
├── prompts/               # Prompts versionados
├── auditorias/            # Registros de auditoria técnica
├── ai-context/            # Contextos auxiliares para agentes de IA
├── deploy/                # Artefatos de entrega futuros
└── scripts/               # Automação operacional futura
```

Os globs do npm são `apps/*`, `packages/*` e `services/backend/*`. Cada unidade mantém
`package.json`, `tsconfig`, scripts e API pública próprios. Consulte
[`docs/architecture/monorepo.md`](docs/architecture/monorepo.md) para o mapa de dependências e as
regras de responsabilidade.

## Pré-requisitos

- Node.js 22.12 ou superior
- npm 10 ou superior
- Git

Os aplicativos Electron não exigem toolchain Rust. A estrutura Tauri anterior permanece
preservada, mas não é usada para executar os MVPs desktop.

## Instalação

Na raiz do repositório:

```bash
npm install
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`. Os valores padrão permitem
iniciar o servidor sem alterar o arquivo. A variável `DATABASE_URL` fica reservada para o Prisma;
o backend não tenta acessar um banco nesta sprint. `REQUEST_TIMEOUT_MS` controla a expiração das
solicitações. `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS` e `RECONNECT_WINDOW_MS` controlam,
respectivamente, o ciclo de verificação, a expiração e a janela de recuperação. Os padrões são
`30000`, `90000` e `90000` milissegundos.

Para gerar novamente o cliente Prisma após alterações futuras no schema:

```bash
npm run prisma:generate
```

## Desenvolvimento

Inicie o backend com recarregamento automático:

```bash
npm run dev
```

O servidor fica disponível em `http://localhost:3000`. Verifique o health check com:

```bash
curl http://localhost:3000/health
```

Resposta esperada:

```json
{
  "status": "ok"
}
```

O processo também registra que o Socket.IO foi inicializado e está aguardando conexões.

## Testando a comunicação em tempo real

Com o backend em execução, abra um segundo terminal na raiz do repositório e execute:

```bash
npm run communication:client
```

O cliente usa `socket.io-client`, conecta-se a `http://localhost:3000`, envia
`communication:ping`, recebe `communication:pong` e encerra a conexão. A saída esperada do
cliente é:

```text
Cliente de teste conectado
Ping enviado
Pong recebido: {"id":"...","event":"communication:pong","timestamp":"...","payload":{"type":"pong"}}
Cliente de teste desconectado
```

No terminal do servidor, o ciclo correspondente é registrado pelo logger:

```text
Cliente conectado
Ping recebido
Pong enviado
Cliente desconectado
```

Todas as mensagens de aplicação seguem o mesmo envelope:

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "event": "communication:pong",
  "timestamp": "2026-07-20T12:00:00.000Z",
  "payload": {
    "type": "pong"
  }
}
```

Mensagens relacionadas a sessões também incluem `sessionId`. IDs de mensagens e sessões são
UUIDs, e timestamps são produzidos em UTC no formato ISO 8601.

## Protocolo de sessões

Os eventos conhecidos ficam centralizados no enum `EventType`:

| Evento               | Direção             | Finalidade                    |
| -------------------- | ------------------- | ----------------------------- |
| `communication:ping` | Cliente → servidor  | Verificar comunicação         |
| `communication:pong` | Servidor → cliente  | Confirmar comunicação         |
| `session:create`     | Cliente → servidor  | Criar uma sessão em memória   |
| `session:created`    | Servidor → cliente  | Retornar a sessão criada      |
| `session:join`       | Cliente → servidor  | Associar o cliente à sessão   |
| `session:leave`      | Cliente → servidor  | Remover o cliente da sessão   |
| `session:close`      | Cliente → servidor  | Encerrar e remover uma sessão |
| `session:closed`     | Servidor → clientes | Confirmar o encerramento      |

Uma sessão começa como `WAITING`, torna-se `ACTIVE` ao possuir dois clientes e passa por
`FINISHED` antes de ser removida do armazenamento em memória.

O teste automatizado conecta dois clientes reais, cria uma sessão, associa ambos, encerra a
sessão e confirma sua remoção:

```bash
npm run test
```

## Presença e disponibilidade

Cada presença registrada contém `clientId`, `connectionId`, `displayName`, `role`, `status` e
`lastSeen`. Os dados existem somente em memória enquanto o servidor estiver em execução.

Papéis disponíveis:

- `STUDENT`;
- `TEACHER`.

Status disponíveis:

- `ONLINE`;
- `AVAILABLE`;
- `BUSY`;
- `OFFLINE`.

Eventos do protocolo:

| Evento               | Finalidade                                     |
| -------------------- | ---------------------------------------------- |
| `presence.register`  | Registrar a presença de uma conexão            |
| `presence.update`    | Atualizar o status do cliente                  |
| `presence.online`    | Notificar ou consultar clientes online         |
| `presence.offline`   | Notificar uma desconexão                       |
| `presence.available` | Notificar ou consultar professores disponíveis |
| `presence.busy`      | Notificar que um cliente está ocupado          |

Para simular dois professores, três alunos, alterações de status e a consulta de professores
disponíveis, inicie o servidor e execute o cliente de presença em outro terminal:

```bash
npm run dev
npm run presence:client
```

O teste automatizado equivalente faz parte de `npm run test`.

## Solicitações de atendimento

Uma solicitação contém `requestId`, `studentId`, `teacherId` opcional, `status`, `createdAt`,
`acceptedAt` opcional e `expiresAt`. O identificador é um UUID e todos os timestamps usam UTC no
formato ISO 8601. Os registros e os controles de timeout existem somente em memória.

Status do ciclo de vida:

- `PENDING`;
- `ACCEPTED`;
- `REJECTED`;
- `CANCELLED`;
- `EXPIRED`.

As rejeições são registradas individualmente por professor. Mesmo quando todos os professores
rejeitam, a solicitação permanece `PENDING` até ser cancelada, aceita por outro destinatário ou
expirar, conforme o protocolo desta sprint. Solicitações em estado terminal deixam a lista de
solicitações ativas, mas permanecem disponíveis no armazenamento em memória enquanto o processo
estiver em execução.

| Evento              | Direção              | Finalidade                                      |
| ------------------- | -------------------- | ----------------------------------------------- |
| `request.create`    | Aluno → servidor     | Criar uma solicitação                           |
| `request.created`   | Servidor → aluno     | Confirmar a criação                             |
| `request.received`  | Servidor → professor | Entregar aos professores disponíveis            |
| `request.accept`    | Professor → servidor | Aceitar uma solicitação pendente                |
| `request.accepted`  | Servidor → clientes  | Confirmar o aceite e remover das demais ofertas |
| `request.reject`    | Professor → servidor | Registrar uma rejeição individual               |
| `request.rejected`  | Servidor → professor | Confirmar a rejeição                            |
| `request.cancel`    | Aluno → servidor     | Cancelar antes do aceite                        |
| `request.cancelled` | Servidor → clientes  | Notificar o cancelamento                        |
| `request.expired`   | Servidor → clientes  | Notificar a expiração                           |

Para executar a simulação com três professores e dois alunos, ajuste temporariamente
`REQUEST_TIMEOUT_MS=1000` no arquivo `.env`, inicie o servidor e execute em outro terminal:

```bash
npm run dev
npm run request:client
```

O cliente cria uma solicitação aceita, registra três rejeições em outra solicitação, cancela essa
solicitação e aguarda a expiração de uma terceira. Com o valor padrão, a última etapa leva 60
segundos. O teste automatizado usa um timeout reduzido e faz parte de `npm run test`.

## Máquina de estados

O workspace `services/backend/services` contém uma infraestrutura genérica em
`src/core/state-machine`. Ela recebe um estado inicial e uma lista tipada de transições, sem
conhecer Requests, Sessions, Calls ou qualquer framework. A implementação oferece:

- validação por grafo explícito;
- `InvalidStateTransitionError` com código `INVALID_STATE_TRANSITION`;
- histórico imutável com estado anterior, novo estado e timestamp;
- assinatura de eventos para cada mudança válida;
- logger injetável para mudança, tentativa inválida e erro de transição.

`RequestStateMachine` configura a infraestrutura com o seguinte grafo:

```text
             ┌──> ACCEPTED
             ├──> REJECTED
PENDING ─────┼──> CANCELLED
             └──> EXPIRED
```

Estados terminais não possuem saídas. Portanto, transições como `EXPIRED → ACCEPTED`,
`CANCELLED → ACCEPTED`, `REJECTED → ACCEPTED`, `ACCEPTED → PENDING`, `ACCEPTED → EXPIRED`,
`ACCEPTED → CANCELLED` e `EXPIRED → PENDING` lançam erro controlado sem alterar estado, histórico
ou emitir evento.

Aceite, cancelamento e expiração de Requests passam obrigatoriamente pela máquina. As rejeições
individuais de professores continuam sendo registros de destinatário e não uma alteração do
estado compartilhado, conforme a Sprint 6. A transição da Request para `REJECTED`, quando
solicitada, também é validada exclusivamente pela máquina.

Os testes de baixo nível percorrem as quatro transições válidas e todas as 21 combinações
inválidas do grafo, além de validar histórico, eventos, logs e reutilização genérica:

```bash
npm run test --workspace=@professor-connect/services
```

## Gerenciamento de Calls

Uma Call representa somente o ciclo técnico posterior ao aceite de uma Request. Não existe
conexão WebRTC ou transmissão de mídia nesta etapa. Cada registro contém:

- `callId`: UUID gerado no servidor;
- `requestId`: Request aceita que originou a Call;
- `sessionId`: associação opcional;
- `studentId` e `teacherId`;
- `status`, `createdAt`, `connectedAt` opcional e `finishedAt` opcional.

O fluxo integrado atual é:

```text
Professor aceita Request
          ↓
Servidor cria Call (CREATED)
          ↓
Servidor prepara conexão (CONNECTING)
          ↓
Futuro adaptador confirma conexão (CONNECTED)
          ↓
Encerramento (FINISHED)
```

Também são permitidos `CREATED → CANCELLED`, `CREATED → FAILED`, `CONNECTING → CANCELLED` e
`CONNECTING → FAILED`. Nenhuma outra transição é aceita.

Eventos definidos no protocolo:

| Evento            | Finalidade                                         |
| ----------------- | -------------------------------------------------- |
| `call.create`     | Comando técnico de criação associado a uma Request |
| `call.created`    | Notificar a Call criada em `CREATED`               |
| `call.connecting` | Notificar o início da preparação                   |
| `call.connected`  | Notificar confirmação futura da conexão            |
| `call.finished`   | Notificar encerramento normal                      |
| `call.cancelled`  | Notificar cancelamento                             |
| `call.failed`     | Notificar falha                                    |

Nesta sprint, o próprio aceite de `request.accept` aciona a criação, sem exigir um segundo comando
do cliente. `call.created` e `call.connecting` são entregues somente ao aluno e ao professor que
aceitou. `CallService` expõe as demais mudanças para um futuro adaptador WebRTC, sem implementar
esse adaptador agora.

Para executar os testes do ciclo completo, falhas, cancelamentos e transições inválidas:

```bash
npm run test --workspace=@professor-connect/services
```

## Heartbeat e recuperação de conexão

Depois de registrar presença, cada cliente passa a ser identificado por um `clientId` estável e
um `connectionId` pertencente ao socket atual. O servidor envia `heartbeat.ping` periodicamente;
o cliente deve responder com `heartbeat.pong`, sempre dentro de `SocketMessage<T>`.

| Evento                 | Direção             | Finalidade                                   |
| ---------------------- | ------------------- | -------------------------------------------- |
| `heartbeat.ping`       | Servidor → cliente  | Solicitar confirmação de atividade           |
| `heartbeat.pong`       | Cliente → servidor  | Atualizar `lastSeen`                         |
| `connection.lost`      | Servidor → clientes | Informar uma perda ainda recuperável         |
| `connection.recovered` | Servidor → cliente  | Entregar o estado restaurado ao novo socket  |
| `connection.timeout`   | Servidor → clientes | Informar expiração e encerramento da conexão |

```text
socket desconecta → LOST → cliente retorna dentro da janela → RECOVERED
                         └→ janela/heartbeat expira → TIMED_OUT + Presence OFFLINE
```

Para recuperar, o novo socket envia novamente `presence.register` com o mesmo `clientId`. O
servidor substitui o `connectionId`, preserva o status de Presence, troca a associação técnica
nas Sessions e devolve um snapshot de Sessions, Requests pendentes e Calls ativas. O socket é
reinscrito nas salas das Sessions. Requests e Calls continuam governadas por seus próprios
ciclos de vida; o timeout não altera seus estados diretamente.

Execute os testes unitários e o teste Socket.IO de recuperação com:

```bash
npm run test --workspace=@professor-connect/services
npm run test --workspace=@professor-connect/websocket
```

## Servidor de sinalização

O módulo `services/backend/websocket/src/modules/signaling` transporta somente dados de negociação entre
dois clientes. Antes de encaminhar, o `SignalingManager` confirma que a Session existe e está
`ACTIVE`, possui exatamente dois clientes conectados, o remetente pertence à Session e a Call
existe, está ativa e corresponde aos participantes. O gateway não cria peer connections, não
interpreta SDP e não acessa câmera, microfone ou qualquer `MediaStream`.

| Evento                 | Direção                  | Payload                      |
| ---------------------- | ------------------------ | ---------------------------- |
| `signal.offer`         | Cliente A → servidor → B | `SignalOfferPayload`         |
| `signal.answer`        | Cliente B → servidor → A | `SignalAnswerPayload`        |
| `signal.ice-candidate` | Qualquer cliente → par   | `SignalIceCandidatePayload`  |
| `signal.error`         | Servidor → remetente     | `SignalErrorPayload`         |
| `screen-share.*`       | Cliente → servidor → par | Payloads de compartilhamento |

Offer e Answer usam `{ callId, sdp }`. ICE usa `{ callId, candidate, sdpMid?,
sdpMLineIndex?, usernameFragment? }`. Erros usam `{ code, message, relatedEvent }`. Todos esses
payloads viajam exclusivamente no envelope `SocketMessage<T>`, com o evento selecionado pelo
enum `EventType` e o identificador da Session em `sessionId`.

O teste automatizado sobe um servidor real, conecta aluno e professor, cria a Session, aceita uma
Request para iniciar a Call e verifica Offer, Answer, ICE nos dois sentidos e `signal.error`:

```bash
npm run test --workspace=@professor-connect/websocket
```

## WebRTC Peer Connection e DataChannel

O workspace `packages/engine` é compartilhado pelos aplicativos de aluno e professor. O fluxo da
Sprint 11 cria um `RTCPeerConnection`, abre o canal padrão `professor-connect-control` e reutiliza
a porta de sinalização da Sprint 10. Ele não chama `getUserMedia`, não adiciona tracks e não envia
áudio ou vídeo.

```text
Aluno                           Signaling                         Professor
  │ Peer + createDataChannel        │                                 │
  ├──── signal.offer ──────────────>├──── signal.offer ──────────────>│
  │                                 │                      cria Answer │
  │<─── signal.answer ──────────────┤<─── signal.answer ──────────────┤
  │<────── signal.ice-candidate ───>│<──── signal.ice-candidate ─────>│
  │<════ SocketMessage<DataChannelMessage<...>> via DataChannel ════>│
```

A máquina de estados específica usa `NEW`, `CONNECTING`, `NEGOTIATING`, `CONNECTED`, `FAILED` e
`CLOSED`. Cada transição passa pela infraestrutura `StateMachine` da Sprint 7 e produz um
`SocketMessage<PeerNegotiationStatePayload>` com `EventType.WEBRTC_PEER_STATE_CHANGED`. O estado
`CONNECTED` exige simultaneamente peer conectado e DataChannel aberto.

Mensagens do canal usam `EventType.WEBRTC_DATA_CHANNEL_MESSAGE` e um envelope
`SocketMessage<DataChannelMessage<DataChannelPayload>>`. O payload interno contém `type`,
`timestamp` e `payload`; a implementação valida toda a estrutura recebida antes de notificá-la.

A configuração fica centralizada em `packages/engine/src/config/webrtc.ts`. As variáveis
`WEBRTC_STUN_URLS`, `WEBRTC_TURN_ENABLED`, `WEBRTC_TURN_URLS`, `WEBRTC_TURN_USERNAME` e
`WEBRTC_TURN_CREDENTIAL` preparam STUN/TURN; TURN permanece desabilitado por padrão.

O teste usa dois peers WebRTC reais em Node, sem mídia, e comprova Offer, Answer, ICE, abertura do
canal, mensagens nos dois sentidos, mudanças de estado e encerramento:

```bash
npm run test --workspace=@professor-connect/engine
```

## RTC Engine de áudio e vídeo

A Sprint 12 adiciona a camada cliente `packages/engine/src/client/core/rtc`. Como aluno e
professor consomem a mesma implementação, ela permanece no workspace compartilhado em vez de ser
duplicada nos dois aplicativos.

- `RtcEngine` é a única API operacional destinada à interface: conecta, recebe signaling,
  reconecta, lista dispositivos, configura mídia e encerra.
- `PeerManager` compõe a fábrica, o signaling e os managers existentes, gerencia ICE e troca o
  runtime inteiro durante uma reconexão.
- `MediaManager` solicita permissões, cria o MediaStream, adiciona/remove tracks, mantém seleção de
  dispositivos e entrega streams para renderizadores.
- `BrowserVideoRenderer` liga a porta de renderização a um `HTMLVideoElement`; vídeo local deve
  ser criado com `muted=true` para evitar retorno de áudio.

```text
Interface → RtcEngine → PeerManager → WebRtcService → Signaling da Sprint 10
                   └──→ MediaManager → getUserMedia → áudio/vídeo local
                                      ← ontrack ← áudio/vídeo remoto
```

As configurações aceitam `deviceId` do microfone e da câmera, além de largura, altura e FPS
preferidos. Sem seleção explícita, o navegador usa os dispositivos padrão. Permissão negada
interrompe a conexão antes da criação do peer e é registrada sem expor dados pessoais.

O teste automatizado cria dois RTC Engines reais, captura uma track de áudio e uma de vídeo em
cada lado, verifica renderização local/remota, executa reconexão com novos peers e confirma o
encerramento das tracks:

```bash
npm run test --workspace=@professor-connect/engine
```

## Compartilhamento de tela

A Sprint 13 estende a camada `packages/engine/src/client/core/rtc` sem expor o peer à interface.
O professor cria uma solicitação, o aluno aceita e passa a compartilhar sua tela. O request usa o
mesmo gateway Socket.IO, `SignalingManager`, Session e Call do fluxo de eventos existente; não há
socket ou protocolo paralelo.

```text
Professor                Relay existente                 Aluno
   │ SCREEN_SHARE_REQUEST ───>│───────────────────────────>│
   │<── SCREEN_SHARE_ACCEPT ──│<───────────────────────────┤
   │<── SCREEN_SHARE_STARTED ─│<──── getDisplayMedia() ────┤
   │<════ mesma conexão WebRTC, câmera substituída por tela ═│
   │<── SCREEN_SHARE_STOPPED ─│<──── usuário encerra ──────┤
   │<════ mesma conexão WebRTC, câmera restaurada ══════════│
```

`ScreenSharingManager` usa `RTCRtpSender.replaceTrack()` pela porta do `PeerManager`; não cria uma
segunda conexão e não renegocia SDP. O áudio do microfone permanece na conexão. Ao receber
`onended` da captura, o manager restaura automaticamente a câmera, atualiza o preview local e
notifica o professor.

A máquina de estados utiliza `IDLE`, `REQUESTED`, `STARTING`, `SHARING`, `STOPPING`, `STOPPED` e
`FAILED` sobre a mesma infraestrutura genérica da Sprint 7. Somente um compartilhamento pode estar
ativo por instância.

```bash
npm run test --workspace=@professor-connect/engine
npm run test --workspace=@professor-connect/websocket
```

## Autorização e transporte de controle remoto

A Sprint 14 adiciona o módulo lógico `client/src/core/remote-control`, localizado em
`packages/engine/src/client/core/remote-control` para permanecer compartilhado entre professor e
aluno. `PermissionManager` mantém a autorização temporária, `RemoteControlManager` protege o
canal e coordena comandos, `CommandDispatcher` valida o protocolo e encaminha para um executor
que, nesta sprint, apenas registra o comando. `RemoteControlService` coordena os eventos de
autorização.

```text
Professor                 Signaling validado                    Aluno
   │ REMOTE_REQUEST ──────────────>│──────────────────────────────>│
   │<────────────── REMOTE_ACCEPT │<──────────────────────────────┤
   │ REMOTE_STARTED ─────────────>│──────────────────────────────>│
   │<════════ REMOTE_COMMAND pelo RTCDataChannel ════════════════>│
   │<────────────── REMOTE_STOPPED│<────────── revogação/stop ────┤
```

Os eventos de autorização `REMOTE_REQUEST`, `REMOTE_ACCEPT`, `REMOTE_DENY`, `REMOTE_STARTED`,
`REMOTE_STOPPED`, `REMOTE_EXPIRED` e `REMOTE_FAILED` passam pelo relay existente como
`SocketMessage<T>`. `REMOTE_COMMAND` não integra os contratos Socket.IO: ele é serializado como
`SocketMessage<RemoteCommandTransportPayload>` diretamente no DataChannel padrão. Cada comando
tem `commandId`, `type`, `timestamp` e um payload nomeado; são suportados `MouseMove`,
`MouseDown`, `MouseUp`, `MouseWheel`, `KeyDown` e `KeyUp`.

A State Machine usa `IDLE`, `REQUESTED`, `AUTHORIZED`, `ACTIVE`, `STOPPING`, `STOPPED`, `DENIED`,
`EXPIRED` e `FAILED`. A autorização possui `authorizationId` e `expiresAt`; comandos só são
aceitos no estado `ACTIVE`, dentro do prazo, para a Call, Session e autorização correspondentes.

```bash
npm run test --workspace=@professor-connect/engine
npm run test --workspace=@professor-connect/websocket
```

Os testes cobrem aceite, recusa, expiração, seis tipos de comando, recebimento, revogação e relay
de autorização. Não há execução real de mouse ou teclado.

## Workflow integrado do MVP

A Sprint 15 adiciona o módulo lógico `client/src/core/workflow`, compartilhado em
`packages/engine/src/client/core/workflow`. Ele não substitui serviços existentes: coordena suas
interfaces e mantém as regras de cada domínio nos módulos de origem.

```text
Conexão → Presence → Request → aceite → Session → Call
        → Signaling → WebRTC → DataChannel → áudio/vídeo
        → Screen Sharing opcional → Remote Control opcional
        → Call finalizada → Session encerrada → recursos liberados
```

`WorkflowManager` mantém o contexto e o estado do atendimento. `WorkflowService` é a fachada de
uso. `HealthCheckService` verifica Socket.IO, Heartbeat, Call, Session, PeerConnection,
DataChannel e MediaStreams. `ResourceManager` encerra recursos em ordem segura, continua a
limpeza quando uma etapa falha e informa um relatório tipado.

Para executar a validação automatizada do MVP integrado:

```bash
npm install
npm run test --workspace=@professor-connect/engine
npm run check
```

O teste `workflow.spec.ts` percorre o atendimento completo, incluindo compartilhamento de tela,
autorização, comando pelo DataChannel, recuperação, encerramento e atendimentos sequenciais. Para
subir o backend usado pelos adapters Socket.IO dos aplicativos:

```bash
Copy-Item .env.example .env
npm run dev
```

As fachadas do Workflow continuam exportadas pelos workspaces existentes. O MVP-1 adiciona a
primeira apresentação visual do aluno sem remover esses pontos de composição.

## Aplicação desktop do aluno — MVP-1

O workspace `apps/student-electron` contém a janela Electron, o preload seguro, o renderer responsivo e
os assets da primeira interface do aluno. A tela não importa Socket.IO, WebRTC nem RTC Engine. Seus
botões chamam somente a API `DesktopWorkflowApi`, exposta pelo preload; no processo principal, o
`StudentWorkflowController` converte as operações para `WorkflowManagerPort`.

```text
Renderer → preload/contextBridge → IPC tipado → StudentWorkflowController → WorkflowManager
```

A interface exibe conexão, estado da solicitação e do atendimento, vídeos local/remoto quando o
Workflow entra em `ACTIVE`, estado do controle remoto e logs de conexão, Request, Call, vídeo,
compartilhamento e falhas. Os textos ficam centralizados em um catálogo `pt-BR`, preparado para a
adição de novos idiomas sem espalhar strings pela lógica de apresentação.

Para instalar, compilar e abrir a aplicação:

```bash
npm install
npm run desktop:student
```

Após uma compilação já realizada, também é possível executar:

```bash
npm run start --workspace=@professor-connect/student-electron
```

Para validar somente o aplicativo desktop:

```bash
npm run typecheck --workspace=@professor-connect/student-electron
npm run test --workspace=@professor-connect/student-electron
npm run build --workspace=@professor-connect/student-electron
```

Detalhes de arquitetura, estados da tela e testes estão em
[`docs/mvp/MVP-1.md`](docs/mvp/MVP-1.md).

## Aplicação desktop do professor — MVP-2

O workspace `apps/teacher-electron` implementa a primeira interface Electron do professor. O
renderer exibe conexão, alunos online, solicitações pendentes, mídia local/remota durante a Call e
um painel limitado aos 100 logs mais recentes. Aceite, recusa, solicitação de compartilhamento,
solicitação de controle remoto e encerramento passam pela API tipada do preload.

```text
Renderer → preload/contextBridge → IPC tipado → TeacherWorkflowController
         → TeacherWorkflowManager → WorkflowManager
```

Nenhum arquivo de apresentação acessa Socket.IO, WebRTC, `RTCPeerConnection` ou RTC Engine. A
fachada do professor adapta a fila de atendimento ao `WorkflowManagerPort` existente e delega o
ciclo integrado de Session, Call, signaling, mídia, DataChannel e liberação de recursos.

Para compilar e abrir a aplicação:

```bash
npm install
npm run desktop:teacher
```

Para validar somente o desktop do professor:

```bash
npm run typecheck --workspace=@professor-connect/teacher-electron
npm run test --workspace=@professor-connect/teacher-electron
npm run build --workspace=@professor-connect/teacher-electron
```

Detalhes de arquitetura, estados, segurança e testes estão em
[`docs/mvp/MVP-2.md`](docs/mvp/MVP-2.md).

## Integração ponta a ponta — MVP-3

O módulo `packages/engine/src/client/core/integration` acrescenta uma orquestração compartilhada
sem copiar regras de Presence, Request, Session, Call, Signaling ou RTC. O aceite de uma Request no
backend agora cria uma Session ativa com os dois participantes, associa a Call e entrega ambos os
eventos antes da negociação. O cliente confirma `call.connected`; o fechamento da Session finaliza
e remove a Call e notifica diretamente os participantes.

```text
Aluno → Presence → Request ───────────────┐
                                         ├→ Session → Call → Signaling
Professor → Presence → lista/aceite ─────┘              ↓
                                            WebRTC → áudio/vídeo
                                                  → Screen Sharing
                                                  → teardown integral
```

As duas interfaces usam os indicadores `🟢 Conectado`, `🟡 Chamando`, `🔵 Em atendimento`,
`🟣 Compartilhando tela` e `🔴 Desconectado`. Os componentes visuais continuam acessando somente
as fachadas de Workflow expostas pelos preloads.

Para executar o cenário local, abra o backend e os dois clientes em terminais separados:

```bash
npm run dev
npm run desktop:student
npm run desktop:teacher
```

Para validar a integração automatizada:

```bash
npm run test --workspace=@professor-connect/engine
npm run test --workspace=@professor-connect/websocket
npm run test --workspace=@professor-connect/student-electron
npm run test --workspace=@professor-connect/teacher-electron
```

O diagrama completo, o roteiro de validação, a configuração para dois computadores e a matriz de
recursos liberados estão em [`docs/mvp/MVP-3.md`](docs/mvp/MVP-3.md).

## Build e execução

Para compilar e executar o backend compilado:

```bash
npm run build
npm run start
```

Outros comandos disponíveis:

```bash
npm run lint          # executa o ESLint em todos os workspaces
npm run typecheck     # valida os tipos sem gerar arquivos
npm run test          # executa os testes automatizados
npm run format:check  # confere a formatação
npm run check         # executa todas as verificações de qualidade
npm run format        # aplica a formatação padronizada
npm run clean         # remove saídas de compilação dos workspaces
```

## Docker para desenvolvimento

O `docker-compose.yml` é exclusivo para desenvolvimento e inicia somente o backend, com o código
local montado no contêiner:

```bash
docker compose up --build
```

Nenhum serviço de banco de dados é criado nesta sprint.

## Empacotamento e produção

Gere os instaladores Windows x64 dos dois perfis com:

```bash
npm run build-student
npm run build-teacher
# ou ambos
npm run build-all
```

Prepare `.env.production` a partir de `.env.example` e publique o backend com:

```bash
npm run deploy-production
```

Guias operacionais:

- [Instaladores Windows](docs/deploy/windows.md);
- [Docker e produção](docs/deploy/production.md);
- [EasyPanel](docs/deploy/easypanel.md).

Consulte o [Guia do Desenvolvedor](docs/DEVELOPER_GUIDE.md), o
[Contexto de IA](AI_CONTEXT.md) e o [Roadmap](docs/ROADMAP.md) antes de iniciar uma nova tarefa.

## Princípios de evolução

- Uma responsabilidade clara por módulo.
- Dependências explícitas e dirigidas para abstrações.
- Contratos pequenos e estáveis entre workspaces.
- Código simples, testável e sem duplicação acidental.
- Mudanças incrementais, verificáveis e documentadas.
