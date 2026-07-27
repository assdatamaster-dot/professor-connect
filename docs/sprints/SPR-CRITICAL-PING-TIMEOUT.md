# Sprint crítica — investigação e correção do `ping timeout`

Data da investigação: 27 de julho de 2026.

## Conclusão

A causa raiz é o envio confiável e contínuo de `mousemove` pelo Socket.IO nos dois trechos do controle remoto:

1. professor → backend;
2. backend → aluno.

Quando o transporte fica temporariamente não gravável, o Engine.IO preserva cada movimento em sua fila confiável. Como uma posição nova substitui as anteriores, esses pacotes são obsoletos, mas a fila continuava crescendo sem limite. O ping/pong usa o mesmo transporte e fica atrás dessa fila. No trecho backend → aluno, o ping pode não chegar ao aluno dentro dos 20 segundos padrão; sem receber o ping, o aluno não envia o pong e o backend registra `ping timeout`.

O evento disparador é `mousemove`. Não foi encontrado bloqueio síncrono do event loop por 20 segundos, IPC síncrono, deadlock ou falha do controlador nativo.

## Localização

Os dois pontos responsáveis pela formação da fila eram:

- `apps/teacher-electron/main/professor-presence.controller.ts`, método `sendRemoteControlMouse`, aproximadamente linha 284;
- `services/backend/websocket/src/modules/remote-control/remote-control.gateway.ts`, listener de `REMOTE_CONTROL_CHANNEL_EVENTS.MOUSE` em `registerSocketEvents`, aproximadamente linha 176.

O segundo ponto é o que explica diretamente o `ping timeout` observado no cliente do aluno: todos os movimentos eram retransmitidos de forma confiável para a conexão dele.

## Por que ocorria somente durante o controle remoto

Sem controle remoto não existe um fluxo contínuo de posições do mouse. Durante o controle, cada movimento gerava tráfego Socket.IO confiável nos dois trechos. O compartilhamento de tela utiliza a mesma conectividade e pode aumentar a probabilidade de indisponibilidade temporária do transporte, mas não foi necessário atribuir a falha à captura de tela: a fila crescente foi reproduzida isoladamente.

## Evidência técnica

Foram adicionados testes que tornam o transporte Engine.IO temporariamente não gravável e enviam 1.000 movimentos.

Antes da correção:

| Trecho              | Fila antes | Fila depois de 1.000 movimentos |
| ------------------- | ---------: | ------------------------------: |
| professor → backend |          0 |                           1.000 |
| backend → aluno     |          0 |                           1.000 |

Os dois testes falharam deliberadamente antes da correção com o valor exato `1000`.

Depois da correção:

| Trecho              | Fila antes | Fila depois de 1.000 movimentos |
| ------------------- | ---------: | ------------------------------: |
| professor → backend |          0 |                               0 |
| backend → aluno     |          0 |                               0 |

Os testes demonstram o mecanismo, e não apenas a ausência eventual do sintoma.

Também foram medidos os componentes suspeitos:

- 100.000 chamadas nativas de `SetCursorPos`: aproximadamente 474 ms no total, média de 4,7 µs e máximo de 1,14 ms;
- teste Electron local anterior à correção, com mais de 51 mil movimentos e 624 eventos de teclado em 62,7 segundos: nenhum bloqueio de event loop próximo dos 20 segundos;
- instrumentação de ping/pong, CPU, memória e atraso do event loop: não revelou freeze do main process ou do renderer capaz de explicar o timeout;
- não existem hooks React ou `useEffect` nesses aplicativos Electron; o fluxo é TypeScript, DOM e Electron main/preload;
- não foram encontrados IPC síncrono, mutex, deadlock, recriação contínua de timers ou registro repetido de listeners no caminho do controle remoto.

## Correção aplicada

Somente `mousemove` passou a usar emissão volátil:

- `socket.volatile.emit(...)` no professor;
- `recipient.volatile.emit(...)` no relay do backend.

Uma posição de mouse volátil pode ser descartada quando o transporte está ocupado, porque a próxima posição a substitui. Eventos que representam ações e não podem ser perdidos continuam confiáveis:

- `mousedown`;
- `mouseup`;
- clique e duplo clique;
- roda do mouse;
- `keydown`;
- `keyup`.

Não houve alteração de arquitetura, aumento de `pingTimeout` ou `pingInterval`, nem mudança no fluxo de autorização.

## Arquivos modificados

- `apps/teacher-electron/main/professor-presence.controller.ts`;
- `apps/teacher-electron/tests/professor-presence.spec.ts`;
- `services/backend/websocket/src/modules/remote-control/remote-control.gateway.ts`;
- `services/backend/websocket/tests/remote-control-channel.spec.ts`;
- este relatório.

## Validação

Verificações automatizadas:

- `npm run check`: aprovado;
- lint: 13 de 13 pacotes;
- typecheck: 13 de 13 pacotes;
- testes: todos aprovados;
- formatação: aprovada;
- `npm run build`: 13 de 13 pacotes;
- testes específicos do professor: 10 de 10;
- testes específicos do websocket: 18 de 18.

Validação real com backend corrigido local, um Electron do professor e um Electron do aluno:

- sessão e videochamada iniciadas;
- compartilhamento de tela iniciado;
- controle solicitado e autorizado;
- movimento, cliques e teclado simultâneos;
- 1.119,77 segundos de eventos processados, equivalentes a 18 minutos e 39 segundos;
- 4.261 movimentos recebidos pelo backend;
- 4.469 eventos confiáveis de botão recebidos;
- 11.015 eventos confiáveis de teclado recebidos;
- zero `ping timeout`;
- zero desconexão ou reconexão inesperada;
- zero encerramento do controle remoto durante a carga.

A única desconexão ocorreu ao final, por encerramento deliberado dos processos Electron, e foi registrada corretamente como `transport close`, não como `ping timeout`.

## Comparação

Antes, a aplicação tentava preservar todas as posições intermediárias e podia impedir que o heartbeat avançasse pelo transporte congestionado. Depois, posições obsoletas são descartadas sob congestionamento, enquanto ações de mouse e teclado permanecem confiáveis. A fila que crescia de 0 para 1.000 pacotes no teste controlado permanece em 0.
