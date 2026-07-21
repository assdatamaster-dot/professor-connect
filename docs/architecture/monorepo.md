# Arquitetura do monorepo

## Objetivo

A Sprint A-1 organiza o Professor Connect por responsabilidade e direção de dependência, mantendo
o comportamento implementado até o MVP-2. A reorganização altera localização física, nomes dos
pacotes compartilhados e configuração dos workspaces; regras de domínio, protocolos, estados e
fluxos operacionais não foram modificados.

## Estrutura

```text
professor-connect/
├── apps/
│   ├── student-desktop/
│   ├── student-electron/
│   ├── teacher-desktop/
│   └── teacher-electron/
├── packages/
│   ├── engine/
│   ├── protocol/
│   ├── shared/
│   └── ui/
├── services/
│   └── backend/
│       ├── api/
│       ├── config/
│       ├── database/
│       ├── services/
│       ├── websocket/
│       └── Dockerfile
├── scripts/
├── docs/
├── package.json
├── tsconfig.base.json
└── turbo.json
```

O npm descobre workspaces pelos globs:

```json
["apps/*", "packages/*", "services/backend/*"]
```

Diretórios de documentação, deploy, auditoria e scripts não são pacotes e não participam do grafo
de build.

## Responsabilidades

### Apps

| Workspace                             | Responsabilidade                                                     |
| ------------------------------------- | -------------------------------------------------------------------- |
| `@professor-connect/student-desktop`  | ponto de composição Tauri preservado do aluno                        |
| `@professor-connect/student-electron` | janela, preload, renderer e adaptação do Workflow para a UI do aluno |
| `@professor-connect/teacher-desktop`  | ponto de composição Tauri preservado do professor                    |
| `@professor-connect/teacher-electron` | janela, preload, renderer e adaptação do Workflow para o professor   |

Aplicações podem compor packages e adapters, mas não publicam regras reutilizáveis nem são
dependências de outros workspaces.

### Packages

| Workspace                     | Responsabilidade                                                              |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `@professor-connect/engine`   | WebRTC, DataChannel, mídia, screen sharing, remote control e Workflow cliente |
| `@professor-connect/protocol` | `EventType`, `SocketMessage<T>` e payloads compartilhados                     |
| `@professor-connect/shared`   | utilitários puros e independentes de produto ou framework                     |
| `@professor-connect/ui`       | elementos visuais realmente reutilizáveis                                     |

`protocol` não possui implementação nem efeitos colaterais. `engine` depende de contratos públicos
e recebe infraestrutura concreta por portas. `shared` e `ui` permanecem independentes enquanto não
existir consumo real.

### Services

| Workspace                      | Responsabilidade                                      |
| ------------------------------ | ----------------------------------------------------- |
| `@professor-connect/api`       | servidor Express, health check e composição HTTP      |
| `@professor-connect/config`    | leitura e validação centralizada do ambiente          |
| `@professor-connect/database`  | Prisma e futura persistência PostgreSQL               |
| `@professor-connect/services`  | casos de uso, stores em memória e State Machines      |
| `@professor-connect/websocket` | gateway Socket.IO, comunicação, heartbeat e signaling |

Os workspaces permanecem separados sob `services/backend` para preservar limites, APIs públicas,
testes e implantação. A pasta interna `services/backend/services` mantém o nome histórico do pacote
de aplicação; ela não representa uma nova raiz de workspace.

## Dependências

```text
apps/student-desktop ─────┐
apps/student-electron ────┼──> packages/engine ──┬──> packages/protocol
apps/teacher-desktop ─────┤                       └──> services/backend/services
apps/teacher-electron ────┘
                                                           │
services/backend/api ──> services/backend/config           │
         │                                                 │
         └────────────> services/backend/websocket ─────────┤
                                  │                        │
                                  └──> packages/protocol <──┘

packages/shared      (independente)
packages/ui          (independente)
services/backend/database (independente)
```

Regras do grafo:

1. Um workspace importa outro somente pelo nome publicado em `package.json`.
2. Não são permitidos imports relativos para `src` de outro workspace.
3. Apps não são dependências de packages ou services.
4. `protocol` não depende de engine, apps ou services.
5. Services de aplicação não dependem de Express, Socket.IO ou Prisma.
6. Configuração de ambiente permanece exclusivamente em `services/backend/config`.
7. Dependências devem permanecer acíclicas.

O subpath `@professor-connect/services/state-machine` continua público porque `engine` reutiliza a
infraestrutura genérica existente. Ele foi preservado para não duplicar código nem alterar
comportamento nesta sprint.

## Fluxo entre módulos

### Atendimento remoto

```text
App Electron
   │ DesktopWorkflowApi
   ▼
Workflow / Engine
   │ SocketMessage<T> + EventType
   ▼
WebSocket ──> Services de aplicação
   │                  │
   │ signaling        ├── Presence / Request / Session / Call / Heartbeat
   ▼                  ▼
Peer remoto       estado em memória
```

1. A aplicação chama exclusivamente o Workflow Manager.
2. O Workflow coordena portas de Presence, Request, Session, Call, signaling e RTC.
3. Mensagens que cruzam o servidor usam contratos de `packages/protocol`.
4. O gateway WebSocket valida o protocolo e delega regras a `services/backend/services`.
5. Offer, Answer e ICE retornam ao Engine sem mover lógica WebRTC para o servidor.
6. DataChannel e mídia permanecem peer-to-peer.

### Backend HTTP

```text
Cliente HTTP → API → Config
                    └── WebSocket → Services → Protocol
```

O processo iniciado por `@professor-connect/api` compõe Express e Socket.IO. `config` fornece o
ambiente validado; `websocket` adapta eventos; `services` executa casos de uso. `database` continua
isolado porque persistência não está implementada no comportamento atual.

## TypeScript e build

Todos os workspaces estendem `tsconfig.base.json`. Workspaces em `apps` e `packages` usam
`../../tsconfig.base.json`; workspaces sob `services/backend` usam
`../../../tsconfig.base.json`.

O Turborepo executa `build`, `lint`, `typecheck`, `test` e `clean`. `tsconfig.base.json` e
`eslint.config.mjs` são dependências globais do cache, o que evita pressupor uma profundidade única
de diretório. Builds dependem dos builds dos workspaces importados.

## Scripts principais

| Comando                   | Finalidade                                      |
| ------------------------- | ----------------------------------------------- |
| `npm run dev`             | iniciar API e Socket.IO em desenvolvimento      |
| `npm run start`           | iniciar o backend compilado                     |
| `npm run desktop:student` | compilar e abrir o Electron do aluno            |
| `npm run build`           | compilar todos os workspaces                    |
| `npm run test`            | executar todos os testes                        |
| `npm run check`           | executar lint, tipos, testes e formatação       |
| `npm run prisma:generate` | gerar o cliente Prisma no workspace de database |

## Docker

O contexto de build continua sendo a raiz, e o Dockerfile fica em
`services/backend/Dockerfile`. A imagem de produção copia API, config, websocket, services e
protocol em seus novos caminhos para preservar os links criados pelos npm workspaces.

## Como validar

```bash
npm install
npm run check
npm run build
```

Para validar capacidades individualmente:

```bash
npm run test --workspace=@professor-connect/services
npm run test --workspace=@professor-connect/websocket
npm run test --workspace=@professor-connect/engine
npm run test --workspace=@professor-connect/student-electron
```
