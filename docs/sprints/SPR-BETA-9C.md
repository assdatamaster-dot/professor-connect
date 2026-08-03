# Sprint BETA-9C — Autenticação, segurança e controle de acesso

## Decisões arquiteturais

1. A identidade canônica é `User`; professor e aluno são perfis 1:1, não identidades paralelas.
2. Todo usuário autenticável pertence a uma `Organization`. Registros e consultas operacionais carregam esse limite de tenant.
3. Access token é curto; refresh token é rotativo e persistido somente por hash. Uma família representa uma sessão simultânea.
4. Papéis agregam permissões. Endpoints e eventos dependem de permissões, evitando condicionais espalhadas por tipo de usuário.
5. O Socket.IO autentica antes de registrar gateways. WebRTC autoriza pelo backend e pelo vínculo do socket à sessão.
6. Google, Microsoft e LDAP aparecem apenas como provedores desabilitados; `ExternalIdentity` permite adicioná-los sem alterar a identidade interna.

## Fluxo de autenticação

```mermaid
sequenceDiagram
  participant UI as Renderer Electron
  participant Main as Processo principal
  participant API
  participant DB as PostgreSQL
  UI->>Main: login(email, senha, instituição)
  Main->>API: POST /api/auth/login
  API->>DB: User + RBAC + bcrypt
  DB-->>API: identidade ativa
  API->>DB: hash do refresh + família
  API-->>Main: identity + access + refresh
  Main->>Main: safeStorage.encryptString
  Main-->>UI: identidade (tokens não são expostos)
```

## Fluxo JWT e refresh

```mermaid
flowchart LR
  L[Login] --> A[Access 15 min]
  L --> R1[Refresh 30 dias / hash no banco]
  R1 --> V{Refresh válido e não revogado?}
  V -->|sim| X[Revoga token anterior]
  X --> R2[Emite novo refresh na mesma família]
  X --> A2[Novo access]
  V -->|token já usado| F[Revoga toda a família]
  V -->|inválido/expirado| D[Nega e limpa sessão local]
```

## Fluxo Socket.IO

```mermaid
sequenceDiagram
  participant E as Electron main
  participant S as Socket.IO
  participant A as AuthService
  E->>S: handshake auth.token
  S->>A: verifyAccessToken
  A-->>S: user + org + roles + permissions + profile
  S->>S: socket.data.identity
  S-->>E: connected
  loop renovação segura
    E->>S: auth:refresh(novo access)
    S->>A: revalidar sessão
    S->>S: exige mesmo user/org/família
  end
```

## WebRTC autenticado

```mermaid
flowchart TD
  U[Usuário autenticado] --> P[Presença derivada do profileId]
  P --> Q[Solicitação entre perfis da mesma organização]
  Q --> S[Sessão ativa com dois sockets]
  S --> O[Offer/Answer/ICE]
  O --> C{Socket pertence à sessão?}
  C -->|sim| R[Backend encaminha ao outro participante]
  C -->|não| N[Evento rejeitado]
  S --> RC[Tela, controle remoto e arquivos seguem a mesma rota]
```

## Fluxo RBAC

```mermaid
flowchart LR
  U[User] --> UR[UserRole]
  UR --> R[Role]
  R --> RP[RolePermission]
  RP --> P[Permission]
  P --> HTTP[Middleware HTTP]
  P --> WS[Handshake/evento Socket]
  HTTP --> T[Escopo tenant + ownership]
  WS --> T
```

## Matriz inicial

| Capacidade                     | Admin | Professor | Aluno |
| ------------------------------ | :---: | :-------: | :---: |
| conectar Socket.IO             |   ✓   |     ✓     |   ✓   |
| listar professores             |   ✓   |     —     |   ✓   |
| listar alunos                  |   ✓   |     ✓     |   —   |
| solicitar sessão               |   ✓   |     —     |   ✓   |
| responder solicitação          |   ✓   |     ✓     |   —   |
| WebRTC/arquivos                |   ✓   |     ✓     |   ✓   |
| pedir controle remoto          |   ✓   |     ✓     |   —   |
| aprovar controle remoto        |   ✓   |     —     |   ✓   |
| administrar usuários/auditoria |   ✓   |     —     |   —   |

## Compatibilidade

Managers, protocolos de sessão, WebRTC, tela, controle remoto, arquivos, persistência e histórico foram preservados. Os gateways mantêm entradas legadas apenas para testes unitários isolados; o servidor de produção sempre instala autenticação antes deles, portanto payloads do cliente não substituem a identidade autenticada.

Consulte a [auditoria completa](../../auditorias/SPR-BETA-9C-AUDITORIA.md).
