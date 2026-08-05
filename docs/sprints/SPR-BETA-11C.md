# Sprint Beta-11C — Fluxo Inteligente de Atendimento

## Entrega

O Professor Connect passa a oferecer um fluxo de atendimento completo e em tempo real entre aluno
e professor. O professor controla sua disponibilidade no aplicativo; o aluno recebe a lista de
professores disponíveis sem recarregar a tela; e cada solicitação pode ser aceita, recusada ou
cancelada. Ao aceitar, a sessão e a negociação WebRTC são iniciadas automaticamente.

O fluxo preserva os recursos existentes de áudio, vídeo, compartilhamento de tela, controle remoto
e transferência de arquivos. Encerrar a sessão limpa esses recursos e persiste início, fim, duração,
participantes e motivo do encerramento.

## Estados do domínio

| Estado apresentado | Persistência                 | Significado                       |
| ------------------ | ---------------------------- | --------------------------------- |
| `PENDING`          | `SessionRequest.PENDING`     | Solicitação aguardando resposta   |
| `ACCEPTED`         | `SessionRequest.ACCEPTED`    | Professor aceitou a solicitação   |
| `IN_PROGRESS`      | `AttendanceSession.ACTIVE`   | Atendimento com sessão ativa      |
| `FINALIZED`        | `AttendanceSession.FINISHED` | Atendimento encerrado normalmente |
| `CANCELLED`        | `SessionRequest.CANCELLED`   | Aluno cancelou antes do aceite    |
| `REJECTED`         | `SessionRequest.REJECTED`    | Professor recusou a solicitação   |

Expirações continuam persistidas como `EXPIRED` e encerramentos inesperados como `INTERRUPTED`,
para que o histórico operacional não perca informação.

## Tempo real

O Socket.IO mantém uma conexão autenticada por aplicativo. Os eventos novos do Beta-11C são:

| Evento                           | Direção                  | Finalidade                              |
| -------------------------------- | ------------------------ | --------------------------------------- |
| `professor:availability:get`     | Professor → servidor     | Solicita o estado atual                 |
| `professor:availability:set`     | Professor → servidor     | Altera disponível/indisponível          |
| `professor:availability:changed` | Servidor → professor     | Confirma e sincroniza o estado          |
| `professors:available:list`      | Servidor → alunos        | Publica a lista filtrada da instituição |
| `session:pending`                | Servidor → aluno         | Confirma a criação da solicitação       |
| `session:cancel`                 | Aluno → servidor         | Cancela solicitação pendente            |
| `session:cancelled`              | Servidor → participantes | Sincroniza o cancelamento               |

A lista é sempre filtrada por `organizationId`. Professores em atendimento ficam `BUSY` e deixam
de aparecer para novos alunos; ao terminar uma sessão, voltam a `AVAILABLE`. Desconexão, timeout e
reinicialização do backend marcam a disponibilidade como `UNAVAILABLE`, evitando presença fantasma.

## Persistência e auditoria

A migration `20260805150000_intelligent_attendance_flow` adiciona `ProfessorAvailability`,
`availability` e `availableSince`, além de um índice para a consulta de professores disponíveis.
As solicitações e sessões reutilizam as tabelas transacionais existentes, com os estados, horários
e duração persistidos pelo Prisma.

São auditados: criação, aceite, recusa, cancelamento, expiração, início e encerramento. Os eventos
incluem os participantes, a organização e, no encerramento, a duração e o motivo.

O histórico unificado está disponível em `GET /api/sessions/history` para aluno e professor. A rota
usa a identidade JWT para retornar somente os atendimentos do próprio usuário e da instituição.

## Experiência nos aplicativos

- Professor: botão de disponibilidade no cabeçalho, notificação visual imediata, aceite/recusa em
  um clique, histórico e indicador de sessão em andamento.
- Aluno: cartões de professores com foto ou iniciais, status, tempo disponível, confirmação antes
  de solicitar, cancelamento enquanto aguarda e histórico.
- Ambos: cronômetro de sessão, áudio/vídeo automáticos, controles de tela, acesso remoto, arquivos e
  encerramento centralizado.
- O tempo disponível é atualizado localmente a cada minuto; o timer e todos os listeners são
  removidos ao fechar a janela.

## Produção

Antes de iniciar uma versão com esta migration:

```bash
npm run prisma:generate
npm run prisma:deploy
npm run build-backend
npm run build-all
```

O startup existente verifica migrations pendentes. PostgreSQL é a fonte persistente, o Socket.IO
fornece baixa latência e os aplicativos Electron continuam compatíveis com Windows. Docker,
Nixpacks e EasyPanel usam o mesmo `prisma migrate deploy` antes da API.
