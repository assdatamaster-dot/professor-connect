# Professor Connect

O Professor Connect é uma plataforma planejada para aproximar alunos e professores em
atendimentos remotos. Este repositório contém a fundação técnica do produto: organização do
monorepo, limites entre módulos, ferramentas de qualidade e documentação para orientar a
evolução do sistema.

> **Estado atual:** Sprint 9 — monitoramento de conexões por heartbeat e recuperação em memória.
> Reconexões dentro da janela preservam o `clientId`, a presença e referências ativas; conexões
> expiradas são encerradas e ficam `OFFLINE`. Não há WebRTC, mídia, autenticação ou persistência.

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
- **Tauri:** base prevista para os aplicativos desktop de aluno e professor.
- **Express:** servidor HTTP e fronteira da API.
- **Socket.IO:** comunicação tipada para ping/pong, sessões, presença, solicitações e eventos de
  ciclo de vida de Calls.
- **Prisma:** cliente configurado para a futura persistência PostgreSQL, ainda sem modelos.
- **ESLint, Prettier e EditorConfig:** análise estática e padronização do código.

Nesta sprint, o backend expõe somente `GET /health` via HTTP. O Socket.IO oferece comunicação,
sessões, presença e o ciclo de vida de solicitações. `STUDENT` e `TEACHER` continuam sendo papéis
técnicos sem login. O Prisma permanece sem modelos, migrações ou acesso ao banco.

## Estrutura de pastas

```text
ProfessorConnect/
├── apps/
│   ├── student-desktop/   # Cliente desktop do aluno
│   └── teacher-desktop/   # Cliente desktop do professor
├── backend/
│   ├── api/               # Servidor Express, health check e tratamento de erros
│   ├── websocket/         # Socket.IO e módulo de comunicação
│   │   └── src/modules/communication/
│   │       ├── communication.gateway.ts
│   │       ├── communication.service.ts
│   │       ├── communication.events.ts
│   │       └── communication.types.ts
│   ├── services/          # Gerenciamento independente em memória
│   │   └── src/
│   │       ├── core/state-machine/ # Máquina de estados genérica
│   │       └── modules/
│   │           ├── call/       # Store, manager, service e máquina de estados de Calls
│   │           ├── connection/ # Registro e heartbeat técnico em memória
│   │           ├── heartbeat/  # Monitoramento, timeout e recuperação de conexões
│   │           ├── presence/   # Presença, status e consultas de disponibilidade
│   │           ├── request/    # Ciclo de vida e armazenamento de solicitações
│   │           └── session/    # Manager, service e store de sessões
│   ├── database/          # Configuração inicial do Prisma, sem modelos
│   └── config/            # Variáveis de ambiente validadas
├── packages/
│   ├── shared-types/      # EventType, SocketMessage e contratos compartilhados
│   ├── shared-utils/      # Utilitários agnósticos
│   └── ui/                # Base visual compartilhada futura
├── docs/                  # Guias e planejamento
├── prompts/               # Prompts versionados
├── auditorias/            # Registros de auditoria técnica
├── ai-context/            # Contextos auxiliares para agentes de IA
├── deploy/                # Artefatos de entrega futuros
└── scripts/               # Automação operacional futura
```

## Pré-requisitos

- Node.js 22.12 ou superior
- npm 10 ou superior
- Git

Rust e as dependências nativas do Tauri serão necessários quando os aplicativos forem
inicializados em uma sprint futura, mas não são necessários para validar esta fundação.

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

O workspace `backend/services` contém uma infraestrutura genérica em
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

Consulte o [Guia do Desenvolvedor](docs/DEVELOPER_GUIDE.md), o
[Contexto de IA](AI_CONTEXT.md) e o [Roadmap](docs/ROADMAP.md) antes de iniciar uma nova tarefa.

## Princípios de evolução

- Uma responsabilidade clara por módulo.
- Dependências explícitas e dirigidas para abstrações.
- Contratos pequenos e estáveis entre workspaces.
- Código simples, testável e sem duplicação acidental.
- Mudanças incrementais, verificáveis e documentadas.
