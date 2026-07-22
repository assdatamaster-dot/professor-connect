# SPRINT BETA-3B — Sessões ativas

## Arquitetura

O módulo `services/backend/websocket/src/modules/active-session` implementa o `SessionManager`
de atendimentos e o `SessionGateway`. Ele é independente do gerenciador técnico de sessões do
workflow legado e preserva integralmente o `SessionRequestManager` do Beta-3A.

Após `session:accept`, o backend mantém `session:accepted`, cria automaticamente uma sessão com
status `active` e envia `session:started` ao professor e ao aluno. A mesma instância do
`SessionManager` é compartilhada com a API REST.

Ao receber `session:end` de um dos participantes, o backend valida a identidade pelo socket,
altera o status para `finished`, remove a sessão da coleção ativa, preserva-a no histórico interno
e envia `session:ended` aos dois participantes.

## Estrutura da sessão

Cada sessão contém:

- `sessionId`;
- `requestId`;
- `teacherId` e `teacherName`;
- `studentId` e `studentName`;
- `createdAt`;
- `status`: `active` ou `finished`.

## Eventos Socket.IO

| Origem             | Evento            | Destino           | Payload                               |
| ------------------ | ----------------- | ----------------- | ------------------------------------- |
| backend            | `session:started` | professor e aluno | dados dos participantes e `sessionId` |
| professor ou aluno | `session:end`     | backend           | `{ sessionId }`                       |
| backend            | `session:ended`   | professor e aluno | dados dos participantes e `sessionId` |

## API REST

- `GET /api/sessions/active`: lista as sessões ativas com `sessionId`, `teacherName`,
  `studentName`, `createdAt` e `status`;
- `GET /api/sessions/:sessionId`: retorna todos os detalhes da sessão ativa ou encerrada;
- `GET /api/sessions/pending` e `GET /api/sessions/history`: permanecem com o comportamento do
  Beta-3A.

## Validação local

1. configure `apps/student-electron/config.json` e `apps/teacher-electron/config.json` com
   `http://localhost:3000`;
2. execute `npm run dev`;
3. execute `npm run desktop:teacher` e conecte o professor;
4. execute `npm run desktop:student`, selecione o professor e solicite atendimento;
5. aceite a solicitação e confirme as mensagens “Aluno conectado” e “Conectado ao professor”;
6. consulte `/api/sessions/active` e `/api/sessions/:sessionId`;
7. encerre pelo botão do professor e confirme “Atendimento encerrado” no aluno;
8. confirme que a lista ativa ficou vazia e que os detalhes da sessão mostram `finished`;
9. execute `npm run build` e `npx turbo run build`.

## Homologação no EasyPanel

Use o fluxo existente em `docs/deploy/easypanel.md`: contexto na raiz do repositório, Dockerfile
em `services/backend/Dockerfile`, proxy HTTP/Socket.IO na porta interna `3000`, HTTPS habilitado e
uma única réplica.

Depois do deploy:

1. valide `/health`;
2. aponte os dois Electron para o domínio HTTPS;
3. valide criação automática, consulta REST e encerramento;
4. confira os logs `Sessão criada`, `Participantes conectados`, `Sessão encerrada` e
   `Sessão removida`;
5. mantenha uma réplica, pois sessões e históricos continuam armazenados em memória.
