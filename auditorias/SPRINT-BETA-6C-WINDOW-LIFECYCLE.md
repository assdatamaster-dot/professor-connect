# SPRINT BETA-6C — Ciclo de vida da janela e controle remoto

Data da auditoria: 27/07/2026

## Resultado

A perda de controle estava no cliente de entrada do professor, não no receptor
nativo do aluno.

O `RemoteControlClient.handleMouseMove` agrupa movimentos com
`requestAnimationFrame`. Quando a janela Electron perde foco e fica oculta por
minimização, o Chromium pode suspender o frame. O identificador permanecia em
`animationFrame`; depois da restauração, `handleMouseMove` interpretava esse
identificador como um frame ainda executável e não agendava outro. Assim, o
fluxo de movimento podia ficar preso apesar de a sessão, o vídeo, o IPC e o
Socket.IO continuarem ativos.

O teclado não possuía encerramento por minimização. Os listeners continuavam
registrados e o tratamento de `blur`/`visibilitychange` apenas liberava teclas
pressionadas. A perda de movimento e foco remoto fazia o teclado parecer
inoperante no uso normal. A regressão agora verifica explicitamente os dois
tipos de entrada após cada restauração.

## Arquivo, função e eventos responsáveis

- Arquivo:
  `apps/teacher-electron/renderer/remote-control.client.ts`
- Função de origem:
  `RemoteControlClient.handleMouseMove`
- Estado que ficava preso:
  `animationFrame` e `pendingMouseMove`
- Eventos de ciclo de vida envolvidos:
  `window.blur` e `document.visibilitychange` com estado `hidden`
- API suspensa pela minimização:
  `requestAnimationFrame`

## Correção aplicada

Foi criado `cancelPendingMouseMove`, que:

1. descarta somente o movimento ainda não enviado;
2. cancela o `requestAnimationFrame` pendente;
3. limpa o identificador do frame.

O método é chamado ao receber `blur`, ao entrar em `hidden` e no `stop`
existente. Ao restaurar, o primeiro movimento agenda um frame novo. O cliente
permanece ativo, os listeners não são removidos e permissões/estado dos
controladores não são reinicializados.

## Auditoria do fluxo

### BrowserWindow e Electron Main

As janelas do professor e do aluno não possuem handlers de `minimize`,
`restore`, `hide`, `show`, `blur` ou `focus` que encerrem a sessão. O único
cleanup de janela é `closed`.

No aluno, `StudentPresenceController`, `RemoteControlReceiver`,
`RemoteInputController`, `RemoteMouseController` e `RemoteKeyboardController`
executam no processo Main. A minimização do Renderer não revoga permissões nem
remove os handlers Socket.IO/IPC.

### Electron Renderer

- Aluno: apenas `beforeunload` executa cleanup; minimizar não dispara esse
  evento.
- Professor: `beforeunload` encerra recursos somente no descarregamento real.
- `RemoteControlClient`: `blur` e `visibilitychange` mantêm o controle ativo e
  liberam entradas pressionadas para evitar tecla/botão preso.
- Não existem handlers de `pagehide`, `pageshow`, `window.focus` ou
  `document.hidden` que parem o controle.

### IPC, controladores e dispatcher

- Os handlers IPC de mouse e teclado só são removidos no `dispose` associado a
  `closed`.
- `RemoteControlReceiver` só encerra por parada explícita, fim de sessão, perda
  real de transporte, reset ou dispose.
- `RemoteInputController` mantém a autorização durante minimizar/restaurar.
- `SetCursorPos` e `SendInput` são executados no Main do aluno.
- Não há classe chamada `InputDispatcher`; a função de despacho é exercida por
  `RemoteControlReceiver` + `RemoteInputController`.

## Arquivos modificados

- `apps/teacher-electron/renderer/remote-control.client.ts`
- `apps/teacher-electron/tests/remote-control.client.spec.ts`
- `scripts/audit-screen-stream.mjs` (somente instrumentação de validação)
- `auditorias/SPRINT-BETA-6C-WINDOW-LIFECYCLE.md`
- `auditorias/beta-6c-baseline.json` (evidência de isolamento)
- `auditorias/beta-6c-window-lifecycle.json` (evidência pós-correção)

Nenhum arquivo de WebRTC, vídeo, Socket.IO, IPC, mouse nativo ou teclado nativo
foi alterado.

## Testes realizados

### Regressão automatizada

O teste novo simula 20 ciclos com:

- movimento pendente em `requestAnimationFrame`;
- `blur`;
- `visibilitychange` para `hidden`;
- restauração para `visible`;
- novo movimento;
- `keydown` e `keyup`.

Resultado: 20 movimentos, 20 `keydown`, 20 `keyup`, nenhum safety stop e cliente
ativo ao final.

Suíte do professor:

- 11 testes aprovados;
- 0 falhas;
- lint aprovado;
- typecheck aprovado;
- build aprovado.

Validação completa do monorepo:

- 11 tarefas de teste aprovadas;
- 13 tarefas de lint aprovadas;
- 13 tarefas de typecheck aprovadas;
- Prettier aprovado nos arquivos da entrega.

### Electron real no Windows

Foi aberta uma sessão real professor/aluno, compartilhada a tela, autorizado o
controle remoto e alternada a janela nativa via Win32:

- 5 ciclos adicionais na janela do aluno para isolar o receptor;
- 6 ciclos normais de minimizar/restaurar a janela do controle;
- 12 ciclos rápidos de minimizar/restaurar;
- 90 segundos de tráfego contínuo de vídeo, mouse e teclado.

Arquivo bruto:
`auditorias/beta-6c-window-lifecycle.json`

Resultados:

- 43/43 amostras com controle do professor em `active`;
- 43/43 amostras com controle do aluno em `active`;
- movimentos sintéticos enviados: 1 → 2.580;
- pares de teclado enviados: 1 → 29;
- eventos confirmados no aluno: `MouseMove`, `KeyDown: a` e `KeyUp: a`;
- vídeo enviado: 13,33 fps medidos;
- vídeo recebido: 13,33 fps medidos;
- 1.122 frames apresentados.

Em duas amostras capturadas enquanto a janela estava efetivamente `hidden`:

| Medida                  | Primeira amostra | Segunda amostra |
| ----------------------- | ---------------: | --------------: |
| Controle professor      |           active |          active |
| Controle aluno          |           active |          active |
| Movimentos enviados     |            1.162 |           1.225 |
| Pares de teclado        |               13 |              14 |
| Tempo do vídeo          |         40,134 s |        42,532 s |
| Frames WebRTC recebidos |              393 |             416 |
| Último evento aplicado  |        MouseMove |       MouseMove |

Depois da restauração, mouse e teclado continuaram chegando, os estados
permaneceram ativos e o encerramento dos controladores ocorreu somente quando a
auditoria encerrou deliberadamente a sessão.

## Executável atualizado

Somente o instalador do professor precisou ser reconstruído, pois a alteração
de produção pertence ao Renderer do professor.

- Arquivo:
  `release/teacher/Professor-Connect-Professor-Setup-0.1.0-x64.exe`
- Tamanho: 99.941.555 bytes
- SHA-256:
  `476A9EDE2E5135176966F0A4D58699AC5569BBEF845F79C65F3B653AC3FA58F9`
- Conteúdo do `app.asar` conferido: `cancelPendingMouseMove` presente.
- Assinatura Authenticode: `NotSigned`.

O instalador do aluno não foi reconstruído nesta Sprint porque nenhum código do
aluno foi alterado pela BETA-6C.
