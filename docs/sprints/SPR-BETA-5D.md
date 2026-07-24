# SPRINT BETA-5D — Estabilização do núcleo de controle remoto

## Resultado

O núcleo foi auditado e estabilizado sem mudança visual significativa e sem adicionar uma nova
capacidade ao usuário. PresenceManager, SessionManager, SessionRequestManager,
RemoteInputController, MouseController, KeyboardController, MediaDeviceManager, WebRTC,
compartilhamento de tela, Socket.IO e os contratos de implantação foram preservados.

As correções se concentram em encerramento determinístico, reconexão, filas limitadas, listeners e
timers descartáveis, tolerância a falhas, redução de trabalho redundante e logs estruturados.

## Arquivos revisados

### Sessão, presença e Socket.IO

- `services/backend/websocket/src/socket-server.ts`;
- `services/backend/websocket/src/modules/professor-presence/presence.manager.ts`;
- `services/backend/websocket/src/modules/student-presence/student-presence.manager.ts`;
- `services/backend/websocket/src/modules/session-request/session-request.manager.ts`;
- `services/backend/websocket/src/modules/active-session/session.manager.ts`;
- `services/backend/websocket/src/modules/remote-control/remote-control.gateway.ts`;
- `services/backend/websocket/src/modules/webrtc-signaling/webrtc-signaling.gateway.ts`;
- `apps/student-electron/main/student-presence.controller.ts`.

### Controle remoto

- `apps/teacher-electron/renderer/remote-control.client.ts`;
- `apps/student-electron/main/remote-control.receiver.ts`;
- `apps/student-electron/main/remote-input/*`;
- `apps/student-electron/main/remote-mouse/*`;
- `apps/student-electron/main/remote-keyboard/*`;
- `packages/protocol/src/remote-control.ts`.

### WebRTC, mídia e compartilhamento

- `apps/teacher-electron/renderer/presence.ts`;
- `apps/student-electron/renderer/index.ts`;
- `packages/engine/src/client/core/media-devices/media-device.manager.ts`;
- controladores de câmera, microfone e compartilhamento do `MediaDeviceManager`;
- módulos WebRTC e testes de reconexão do `packages/engine`.

### Produção

- `services/backend/Dockerfile`;
- `docker-compose.production.yml`;
- `nixpacks.toml`;
- `docs/deploy/easypanel.md`;
- configurações de empacotamento Electron dos aplicativos do professor e do aluno.

## Problemas encontrados e corrigidos

| Área              | Problema encontrado                                                                                             | Correção                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Teclado           | `keypress` era capturado junto com `keydown`/`keyup`, gerando tráfego redundante.                               | O emissor usa somente `keydown` e `keyup`; o protocolo continua aceitando `keypress` legado sem reinjeção.                             |
| Transporte        | Falha assíncrona ao enviar mouse/teclado apenas notificava erro e podia deixar listeners ativos.                | A primeira falha de transporte remove listeners e solicita parada segura imediatamente.                                                |
| Autorização       | Pedido de controle pendente não expirava no gateway.                                                            | Timeout configurável, cancelamento do timer em todos os finais e `reason: timeout` sincronizado para os dois participantes.            |
| Gateway           | Registro de eventos não era idempotente e o listener de conexão era anônimo.                                    | Registro idempotente, referência estável do listener e remoção explícita em `dispose()`.                                               |
| Encerramento      | Uma exceção ao liberar teclado podia impedir a liberação do mouse, ou vice-versa.                               | Permissão revogada primeiro; cada controlador é encerrado isoladamente e a falha é registrada sem escapar.                             |
| Biblioteca nativa | Koffi e `user32.dll` eram carregados durante a importação do módulo.                                            | Bindings lazy e em cache; falhas passam pelo tratamento central do controle remoto sem derrubar o boot do aplicativo.                  |
| Mouse             | Cada `mousemove` gerava log e notificação ao renderer.                                                          | Todos os movimentos continuam executados, mas log/notificação são amostrados a cada 250 ms.                                            |
| Backend           | Cada `mousemove` também gerava log Socket.IO.                                                                   | Transporte integral com amostragem independente apenas do log.                                                                         |
| ICE               | Candidatos de sessão antiga podiam criar filas e as filas não tinham limite.                                    | Descarte por sessão e limite de 256 candidatos por sessão em ambos os renderers.                                                       |
| WebRTC            | Estado `failed`/`disconnected` não iniciava recuperação automática no fluxo Electron.                           | Professor, como offerer, agenda renegociação com `iceRestart`, evita concorrência e tenta novamente enquanto a sessão continua válida. |
| Streams           | Tracks, mapas de streams e filas de renegociação podiam sobreviver ao fim da sessão.                            | Handlers anulados, timers cancelados, tracks paradas, mapas/filas limpos e streams encerrados removidos.                               |
| Dispositivos      | Vários `devicechange` podiam disparar enumerações concorrentes; uma enumeração podia terminar após `dispose()`. | Atualizações concorrentes coalescidas e resultados tardios descartados sem emitir estado.                                              |
| Logs              | Havia formatos diferentes e chamadas diretas a `console` no runtime.                                            | Logger compartilhado em JSON com `timestamp`, `level`, `origin`, `event` e `data`; backend segue o mesmo contrato.                     |

## Arquitetura resultante

```text
Sessão e presença válidas
          │
          ▼
RemoteControlGateway
├── autorização pendente + timeout descartável
├── validação de socket, papel, sessão e participante
├── transporte integral de entrada
└── parada por sessão, participante, desconexão, falha ou timeout
          │
          ▼
RemoteControlReceiver
          │
          ▼
RemoteInputController
├── InputPermissions (revogada antes de qualquer cleanup)
├── MouseController ── WindowsMouseAdapter lazy
└── KeyboardController ── WindowsKeyboardAdapter lazy
```

O logger estruturado comum fica no engine e atende mídia, workflows e controle remoto. Os
adaptadores nativos continuam usando `koffi@3.1.2` e `SendInput`; nenhuma biblioteca foi adicionada.

## Segurança e interrupção

O gateway ainda exige sessão ativa, socket do professor associado, socket do aluno associado e
autorização ativa. Um evento inválido é descartado pelo tratamento central e nunca chega ao
adaptador nativo.

Parada, fim de sessão, desconexão, falha de transporte, perda de foco, falha nativa ou expiração:

1. revogam a permissão central;
2. removem os listeners do professor;
3. liberam teclado e mouse de forma independente;
4. cancelam o timeout da autorização;
5. limpam estado de sessão, logs amostrados e filas relacionadas.

## Performance

- remoção do evento de teclado redundante `keypress` no emissor;
- coalescência de atualizações simultâneas do `MediaDeviceManager`;
- limite de 256 candidatos ICE pendentes por sessão;
- descarte imediato de ICE de sessão antiga;
- amostragem de logs/notificações de mouse em 250 ms sem reduzir a frequência de execução;
- remoção de streams encerrados e reset de filas ao finalizar a chamada.

## Evidências e testes

Executados em 24/07/2026:

| Verificação                    | Resultado                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `npm run test`                 | Aprovado: 101 testes, 0 falhas                                                |
| `npm run typecheck`            | Aprovado: 13/13 pacotes                                                       |
| `npm run lint`                 | Aprovado após correção dos dois imports de tipo nativos                       |
| `npm run build`                | Aprovado: 13/13 pacotes                                                       |
| `npx turbo run build`          | Aprovado: 13/13 pacotes                                                       |
| Backend compilado              | `/health` retornou HTTP 200 e `{"status":"ok"}`                               |
| Encerramento do backend        | SIGINT fechou Socket.IO/HTTP e registrou encerramento sem erro                |
| Instalador do aluno            | Gerado: `Professor-Connect-Aluno-Setup-0.1.0-x64.exe`                         |
| Instalador do professor        | Gerado: `Professor-Connect-Professor-Setup-0.1.0-x64.exe`                     |
| Smoke dos aplicativos unpacked | Ambos permaneceram ativos por 8 segundos e foram encerrados pelo teste        |
| Conteúdo ASAR                  | Controladores estabilizados e logger compartilhado presentes nos dois pacotes |

Os testes automatizados exercitam autorização e isolamento, rejeição, timeout, desconexão,
transporte de mouse/teclado, falha de transporte, liberação resiliente, atalhos, troca e remoção de
dispositivos, compartilhamento, renegociação, reconexão e limpeza de recursos.

Hashes SHA-256 dos instaladores:

```text
Aluno:     685855414FC3348570742BEE8F885AC1F06E1AEFADAD2166D68630E3F4520172
Professor: E2E98A82AE54713621AC6F76774A0092706327ECB2A55F9B749E94AADD61B9B8
```

## Docker e EasyPanel

O Dockerfile multiestágio, a imagem sem privilégios, o healthcheck, a porta 3000, o encerramento por
SIGTERM, o Compose de produção e o roteiro do EasyPanel foram revisados e não precisam de mudança
para esta sprint. O build e o smoke do mesmo backend compilado usado pela imagem passaram.

O host desta auditoria não possui os comandos `docker` nem `nixpacks`; portanto, o build real da
imagem e um deploy no EasyPanel não foram simulados localmente. A homologação externa continua sendo
um gate de release, e não é correto declará-la concluída apenas com validação estática.

## Arquivos alterados

- processos principais e renderers Electron do aluno e professor;
- controladores de entrada remota e adaptadores Windows;
- `MediaDeviceManager` e barrel do engine;
- protocolo e gateway Socket.IO de controle remoto;
- composição do servidor WebSocket e logger da API;
- testes de engine, gateway e aplicativos Electron;
- `README.md`.

## Arquivo criado

- `packages/engine/src/client/core/media-devices/structured-logger.ts`;
- `docs/sprints/SPR-BETA-5D.md`.

## Pendências futuras

- executar homologação manual com dois computadores Windows, câmera/microfone reais, múltiplos
  monitores e perda física de rede;
- executar soak test prolongado com repetição de sessões e coleta de memória;
- construir a imagem Docker e validar um deploy EasyPanel em ambiente de homologação;
- manter uma única réplica enquanto presença e sessões continuarem em memória;
- tratar clipboard, arquivos, comandos avançados e automações em permissões e canais próprios, sem
  reutilizar implicitamente a autorização de mouse/teclado.

## Correção pós-entrega do login do professor

Foi identificada uma falha de empacotamento na primeira entrega da Beta-5D: o
`MediaDeviceManager` compilado era copiado para o renderer isolado, mas seu novo import do logger
apontava para fora da pasta copiada. Como o módulo `presence.js` não terminava de carregar, o
listener do formulário **Entrar** não era registrado.

O logger foi mantido compartilhado, porém reposicionado dentro da fachada autocontida de mídia. O
validador de módulos ESM agora também rejeita imports relativos que escapem do diretório `dist`,
impedindo a repetição desse tipo de falha.

Após o novo empacotamento, um teste CDP no executável do professor confirmou:

- renderer com `document.readyState: complete`;
- bridge `professorConnectPresence.connect` disponível;
- nenhum `Runtime.exceptionThrown`;
- clique em **Entrar** ocultando o login;
- área online exibida com o nome informado.
