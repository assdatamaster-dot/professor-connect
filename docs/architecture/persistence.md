# Arquitetura de persistência

## Dependências

```mermaid
flowchart TD
  HTTP[Controllers HTTP] --> Domain[Services / Managers]
  WS[Gateways Socket.IO] --> Domain
  Domain --> Ports[Interfaces Repository]
  Ports --> Adapters[Repositories no pacote database]
  Adapters --> Queue[Fila ordenada de persistência]
  Queue --> Prisma[Prisma Client]
  Prisma --> PG[(PostgreSQL)]
```

O domínio não importa `@prisma/client`. As interfaces ficam nos pacotes `services` e `websocket`; os adapters concretos ficam em `@professor-connect/database` e são injetados pela API.

## Relacionamentos centrais

```mermaid
erDiagram
  ORGANIZATION ||--o{ USER : possui
  ORGANIZATION ||--o{ PROFESSOR : agrega
  ORGANIZATION ||--o{ STUDENT : agrega
  USER ||--o{ USER_ROLE : recebe
  ROLE ||--o{ USER_ROLE : classifica
  ROLE ||--o{ ROLE_PERMISSION : concede
  PERMISSION ||--o{ ROLE_PERMISSION : integra
  PROFESSOR ||--o{ PRESENCE_CONNECTION : conecta
  STUDENT ||--o{ PRESENCE_CONNECTION : conecta
  STUDENT ||--o{ SESSION_REQUEST : solicita
  PROFESSOR ||--o{ SESSION_REQUEST : atende
  SESSION_REQUEST ||--o{ SESSION_REQUEST_RECIPIENT : distribui
  SESSION_REQUEST ||--o| ATTENDANCE_SESSION : origina
  ATTENDANCE_SESSION ||--o{ FILE_TRANSFER : registra
  ATTENDANCE_SESSION ||--o{ DOMAIN_EVENT : produz
```

## Escrita e consistência

Os contratos Socket.IO existentes são síncronos. Para não mudar a experiência, os adapters enfileiram gravações e as executam sequencialmente. Assim, uma pessoa é criada antes da presença e uma solicitação antes da sessão relacionada. Operações compostas são transações Prisma. `flush()` torna falhas visíveis e é obrigatório no shutdown.

## Inicialização e restart

```mermaid
sequenceDiagram
  participant API
  participant RecoveryRepository
  participant PostgreSQL
  participant Managers
  API->>RecoveryRepository: recoverAfterRestart()
  RecoveryRepository->>PostgreSQL: transação de reconciliação
  API->>PostgreSQL: carrega históricos
  API->>Managers: injeta repositories + históricos
  API->>API: abre HTTP/Socket.IO
```

Conexões de socket não são restauradas, pois deixaram de existir. Elas são marcadas offline. Sessões abertas tornam-se interrompidas e continuam consultáveis no histórico.

## Operação

- Desenvolvimento: `docker compose up --build`.
- Aplicar migrations: `npm run prisma:deploy --workspace=@professor-connect/database`.
- Gerar client: `npm run prisma:generate`.
- Seed: `npm run prisma:seed --workspace=@professor-connect/database`.
- Produção: defina `POSTGRES_PASSWORD` e, quando externo ao Compose, `DATABASE_URL`.

Não registre tokens, senhas, SDP WebRTC, conteúdo de arquivos ou eventos de mouse/teclado em logs/auditoria.
