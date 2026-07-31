# Sprint Beta-9B — Persistência de Dados e Infraestrutura

Data da auditoria: 31/07/2026  
Escopo: `services/backend`, composição da API e infraestrutura de produção.

## Auditoria anterior à implementação

O backend possuía um `schema.prisma` vazio e um `PrismaClient` sem consumidores. O `DATABASE_URL` estava apenas reservado no `.env.example`; os Compose não iniciavam PostgreSQL e o container de produção não executava migrations.

Pontos de estado encontrados:

| Área                      | Arquivo/componente anterior                    | Estado em memória                            | Classificação                                                                      |
| ------------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| Professores               | `professor-presence/presence.manager.ts`       | `professorsBySocketId`                       | identidade, presença e heartbeat relevantes                                        |
| Alunos                    | `student-presence/student-presence.manager.ts` | `studentsBySocketId`                         | identidade, presença e heartbeat relevantes                                        |
| Solicitações Beta         | `session-request/session-request.manager.ts`   | histórico, pendências e timers               | domínio e histórico persistentes; timers efêmeros                                  |
| Sessões Beta              | `active-session/session.manager.ts`            | ativas, histórico, request→session e sockets | domínio/histórico persistentes; rotas de sockets efêmeras                          |
| Controle remoto           | `remote-control.gateway.ts`                    | autorizações, timers e throttle de log       | uso e eventos importantes persistentes; timers/throttle efêmeros                   |
| Compartilhamento          | `webrtc-signaling.gateway.ts`                  | evento apenas retransmitido                  | indicador de uso não era registrado                                                |
| Presença de protocolo     | `services/presence.manager.ts`                 | clientes e índice por conexão                | presença relevante                                                                 |
| Solicitações de protocolo | `services/request.store.ts`                    | solicitações, destinatários e recusas        | domínio persistente                                                                |
| Calls                     | `services/call.store.ts`                       | calls                                        | domínio persistente                                                                |
| Sessões de protocolo      | `services/session.store.ts`                    | sessões e participantes                      | domínio persistente                                                                |
| Máquinas de estado        | managers e `StateMachine`                      | instâncias e transições                      | estado atual persistido nas entidades; eventos relevantes em `domain_events`       |
| Heartbeat/conexões        | managers de conexão/heartbeat                  | mapas, inspeções e timers                    | operacional/efêmero; presença consolidada é persistida                             |
| Transferência de arquivos | clientes Electron/DataChannel                  | arquivos e JSONL local                       | arquivos continuam P2P; metadados finais também são enviados ao repository central |
| Logs                      | `api/utils/logger.ts`                          | somente stdout JSON                          | logs relevantes agora têm adapter PostgreSQL                                       |

`Set`s de listeners, timers de expiração, índices de socket, filas de ICE e throttles continuam em memória intencionalmente: são recursos do processo e não representam fonte de verdade recuperável.

## Estrutura anterior

Fluxo efetivo: `Controller/Gateway → Manager/Service → Map/Set`. Reiniciar o backend apagava históricos e fazia a API voltar vazia. Não havia migrations, seed, constraints, índices de domínio, recuperação ou flush no shutdown.

## Nova arquitetura

Fluxo: `Controller/Gateway → Service/Manager → porta Repository → adapter Prisma → PostgreSQL`.

- Services/managers dependem somente de interfaces de persistência.
- O pacote `database` implementa os adapters e é o único que importa Prisma.
- Uma fila serial preserva a ordem entre gravações relacionadas sem transformar contratos Socket.IO síncronos em contratos assíncronos incompatíveis.
- Operações compostas usam `$transaction`.
- O bootstrap aguarda recuperação e leitura dos históricos antes de abrir a porta HTTP.
- O shutdown aguarda `flush()` antes de desconectar o Prisma.

## Entidades

- Multi-tenant e autenticação futura: `Organization`, `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `AuthToken`.
- Pessoas e presença: `Professor`, `Student`, `PresenceConnection`.
- Atendimento: `SessionRequest`, `SessionRequestRecipient`, `AttendanceSession`, `WorkflowSession`, `WorkflowSessionParticipant`, `SupportCall`.
- Operação: `FileTransfer`, `DomainEvent`, `AuditLog`, `ApplicationLog`.

O histórico de atendimento registra professor, aluno, início, fim, duração, status, motivo de encerramento e indicadores de tela, controle remoto e arquivos.

## Migrations

1. `20260731090000_identity_and_access`: organização, usuários, RBAC, tokens, professores e alunos.
2. `20260731091000_support_workflow`: presença, solicitações e atendimentos.
3. `20260731091500_protocol_workflow`: destinatários, calls e sessões do protocolo legado.
4. `20260731092000_events_audit_and_transfers`: eventos, auditoria, logs e transferências.

Cada migration tem responsabilidade única. As constraints impedem participante incompatível com o papel, duração/bytes negativos e relacionamentos órfãos. Índices cobrem status/tempo, participante/tempo e consultas de auditoria.

## Repositories e serviços alterados

Repositories: professor, aluno, solicitação Beta, sessão de atendimento, transferência, auditoria, recuperação, presença de protocolo, solicitação de protocolo, call e sessão de protocolo.

Managers/stores alterados: presença de professor/aluno, solicitação/sessão Beta, presença/solicitação/call/sessão de protocolo. Gateways de tela e controle remoto registram uso na sessão. A API passou a compor os adapters e a recuperar histórico antes do `listen`.

## Recuperação e integridade

Na inicialização, uma única transação:

- marca conexões antigas como offline;
- expira solicitações pendentes;
- encerra sessões Beta ativas como `INTERRUPTED`, com duração e motivo `server-restart`;
- encerra sessões genéricas abertas;
- marca calls incompletas como falhas;
- cria um registro de auditoria da recuperação.

Históricos Beta são então carregados nos managers usados pelos controllers, preservando os contratos HTTP existentes.

## Infraestrutura e seed

Os Compose de desenvolvimento e produção incluem PostgreSQL 17, volume persistente, healthcheck e dependência saudável. A imagem executa `prisma migrate deploy` antes do backend. O seed idempotente cria organização, perfis, professor, aluno, solicitação e sessão encerrada de desenvolvimento.

## Benefícios e próximas Sprints

A fonte de verdade deixa de ser o processo Node. A separação por portas permite trocar adapters e testar domínio sem PostgreSQL. A modelagem já suporta múltiplas instituições, autenticação, RBAC, tokens, dashboard, relatórios por período/participante e auditoria. Próximas Sprints podem acrescentar login e painel sem mover entidades centrais ou permitir Prisma dentro de Services.

## Observação sobre arquivos

O conteúdo dos arquivos continua trafegando diretamente pelo DataChannel e não é armazenado no servidor, preservando privacidade e desempenho. Ao finalizar, o remetente envia a auditoria já produzida pelo cliente ao gateway `file-transfer:audit`; o servidor valida participante/sessão e persiste metadados, checksum, direção, duração e resultado por `FileTransferRepository`, sem armazenar bytes.
