# Sprint — Fila de atendimento

## Arquitetura e estados

A fila reutiliza `SessionRequest`, `SessionRequestManager`, `SessionManager`, presença autenticada e
o servidor Socket.IO existente. Não há segunda entidade de atendimento nem polling.

O mapeamento de estados é:

| Conceito da fila                   | Estado persistido                             |
| ---------------------------------- | --------------------------------------------- |
| `WAITING`                          | `SessionRequest.status = PENDING`             |
| `CALLED`                           | `SessionRequest.status = ACCEPTED`            |
| `IN_PROGRESS`                      | `AttendanceSession` em estado ativo/conectado |
| `COMPLETED`                        | `AttendanceSession.status = FINISHED`         |
| `CANCELLED`, `EXPIRED`, `REJECTED` | estados equivalentes de `RequestStatus`       |

`queuedAt` diferencia a solicitação direta, criada com o professor disponível, da solicitação que
entrou na fila durante uma reserva ou atendimento. A ordem é sempre calculada no backend por
`createdAt ASC, requestId ASC`.

## Fluxo

1. Professor disponível: a solicitação segue o aceite manual existente e mantém o timeout
   configurado por `REQUEST_TIMEOUT_MS`.
2. Professor ocupado: a solicitação `PENDING` é preservada sem timeout de interface, recebe posição
   autoritativa e aguarda em FIFO.
3. Encerramento: `SessionManager` libera a sessão; o gateway seleciona atomicamente, no processo, o
   primeiro aluno online, muda a request para `ACCEPTED` e reutiliza `SessionGateway.startSession`.
4. Cancelamento: a request vira `CANCELLED` e todos os snapshots afetados são recalculados.
5. Desconexão do professor: requests permanecem no manager e no PostgreSQL. Na reconexão, a presença
   é sincronizada como `busy`, a fila é reemitida e uma chamada pendente pode prosseguir.

## Eventos Socket.IO

Todos usam o Socket.IO autenticado e são enviados apenas ao professor ou aluno envolvidos:

- `session:queue:get`: solicita restauração do snapshot após conexão/reconexão;
- `session:queue:updated`: posição privada do aluno, quantidade à frente e presença do professor;
- `session:queue:cleared`: remove estado local obsoleto após uma reconexão;
- `session:queue:changed`: lista completa da fila para o professor responsável;
- `session:pending` e `session:requested`: solicitação criada;
- `session:accepted`: aluno chamado;
- `session:cancelled`, `session:timeout`, `session:rejected`: estados terminais da request;
- `session:started` e `session:ended`: ciclo da sessão existente, agora com `requestId` no payload.

## API e privacidade

`GET /api/sessions/queue` usa a identidade JWT:

- aluno: somente sua request, posição, quantidade à frente, espera e próximo passo;
- professor: somente nomes e posições dos alunos da própria fila;
- perfis sem professor/aluno: `403`.

O parâmetro de professor enviado pelo cliente é ignorado; a consulta sempre usa `profileId` do
token.

## Concorrência e persistência

O event loop serializa as mutações do manager e a ordenação possui desempate por UUID/ID. Antes de
criar sessão, `SessionManager` verifica professor e aluno ativos. A migration
`20260810120000_professor_attendance_queue` adiciona:

- `session_requests.queued_at` (nullable e sem backfill destrutivo);
- índice da leitura FIFO;
- índice único parcial para uma request `PENDING` por aluno;
- índice único parcial para uma sessão não finalizada por professor.

As constraints do PostgreSQL são a última barreira para múltiplas instâncias. Enquanto não houver
adapter Socket.IO/coordenação distribuída, o deploy deve continuar com uma réplica, conforme a
documentação de produção.

## Interfaces

O aluno vê professores disponíveis e ocupados. Apenas solicitações realmente enfileiradas exibem
posição, alunos à frente, presença do professor e contador local derivado do timestamp oficial.
Quando chamado, o estado muda sem reload e o fluxo de mídia existente é iniciado.

O professor vê quantidade, posição, nome, estado e espera de toda a própria fila. Durante uma sessão
ativa a fila continua visível; o diálogo de aceite aparece somente quando não existe atendimento.

## Deploy no EasyPanel

> A integracao de Presence operacional, estados, eventos e release 0.1.2 esta documentada em
> `SPR-ATTENDANCE-PRESENCE-OPERATIONAL.md`.

1. Faça backup/snapshot do PostgreSQL.
2. Mantenha uma réplica do backend.
3. Publique a nova imagem sem sobrescrever o comando padrão; o `prestart` executa
   `prisma migrate deploy`.
4. Confirme no log a aplicação de `20260810120000_professor_attendance_queue` e o início da API.
5. Execute `npm run prisma:status` e valide `/health`.
6. Faça smoke test com um professor, uma sessão ativa e dois alunos na fila.

Não use `prisma db push` e não altere migrations históricas.
