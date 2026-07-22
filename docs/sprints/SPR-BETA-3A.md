# SPRINT BETA-3A — Solicitação de atendimento

## Arquitetura

O fluxo foi adicionado como um módulo independente em
`services/backend/websocket/src/modules/session-request`. O `SessionRequestManager` usa os
gerenciadores de presença existentes para localizar o aluno pelo socket e o professor pelo ID,
mantém solicitações pendentes em memória, preserva o histórico e agenda a expiração fixa em 30
segundos.

A mesma instância do gerenciador é entregue ao gateway Socket.IO e à API Express em
`services/backend/api/src/server.ts`. Assim, os endpoints REST representam o estado atualizado
pelos eventos em tempo real sem alterar os módulos legados de Presence, Heartbeat, Request,
Session, Call ou Signaling.

## Eventos Socket.IO

| Origem    | Evento              | Destino   | Payload                                 |
| --------- | ------------------- | --------- | --------------------------------------- |
| aluno     | `request:session`   | backend   | `{ teacherId }`                         |
| backend   | `session:requested` | professor | `{ requestId, studentId, studentName }` |
| professor | `session:accept`    | backend   | `{ requestId }`                         |
| professor | `session:reject`    | backend   | `{ requestId }`                         |
| backend   | `session:accepted`  | aluno     | `{ requestId, teacherId, teacherName }` |
| backend   | `session:rejected`  | aluno     | `{ requestId, teacherId, teacherName }` |
| backend   | `session:timeout`   | aluno     | `{ requestId, teacherId, teacherName }` |

Aceite, recusa e expiração removem a solicitação da coleção de pendentes e atualizam o registro
mantido no histórico. O fluxo não inicia vídeo, áudio, compartilhamento de tela ou controle remoto.

## API REST

- `GET /api/sessions/pending`: retorna um array com as solicitações cujo status é `pending`;
- `GET /api/sessions/history`: retorna um array com todas as solicitações criadas e seu status
  atual (`pending`, `accepted`, `rejected` ou `expired`).

Cada item contém `requestId`, `studentId`, `studentName`, `teacherId`, `teacherName`, `status` e
`createdAt`.

## Validação local

1. execute `npm ci` na raiz;
2. configure temporariamente `apps/student-electron/config.json` e
   `apps/teacher-electron/config.json` com `http://localhost:3000`;
3. inicie o backend com `npm run dev`;
4. em terminais separados, execute `npm run desktop:teacher` e `npm run desktop:student`;
5. conecte o professor, selecione-o no aplicativo do aluno e solicite atendimento;
6. valide separadamente Aceitar, Recusar e a ausência de resposta por 30 segundos;
7. consulte `http://localhost:3000/api/sessions/pending` e
   `http://localhost:3000/api/sessions/history`;
8. execute `npm run build` e `npx turbo run build` na raiz.

## Homologação no EasyPanel

Use o processo descrito em `docs/deploy/easypanel.md`: contexto na raiz, Dockerfile em
`services/backend/Dockerfile`, proxy HTTP na porta interna `3000`, HTTPS habilitado e exatamente
uma réplica. O estado de solicitações e o histórico são mantidos em memória e são reiniciados a
cada deploy.

Após publicar a branch/tag:

1. valide `GET /health`;
2. conecte os dois Electron com o `serverUrl` HTTPS do serviço;
3. valide aceite, recusa e timeout;
4. confirme os endpoints `/api/sessions/pending` e `/api/sessions/history`;
5. confira nos logs `Nova solicitação`, `Professor notificado`, `Solicitação aceita`,
   `Solicitação recusada` e `Solicitação expirada`.
