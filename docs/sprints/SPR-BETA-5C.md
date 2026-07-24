# SPRINT BETA-5C — Controle remoto de teclado

## Escopo

A Beta-5C habilita teclado e atalhos no computador do aluno somente durante uma sessão ativa e após
autorização explícita. Mouse, WebRTC, compartilhamento de tela, PresenceManager, SessionManager,
SessionRequestManager, MediaDeviceManager e o fluxo de produção permanecem preservados.

São aceitos `keydown`, `keyup` e `keypress`. A injeção nativa ocorre em `keydown`/`keyup`;
`keypress` é transportado e auditado quando o navegador o produz, mas não é reinjetado para evitar
digitação duplicada.

## Arquitetura

```text
Professor renderer
  RemoteControlClient
  ├─ MouseController (captura)
  └─ KeyboardController (captura + bloqueio do atalho local)
          │ IPC validado
          ▼
Professor main ── remote-control:mouse/keyboard ──► Backend Socket.IO
                                                       │ sessão, papel e autorização
                                                       ▼
Aluno main
  RemoteControlReceiver
  └─ RemoteInputController
     ├─ InputPermissions
     ├─ InputEvents / atalhos
     ├─ RemoteMouseController
     └─ RemoteKeyboardController
        └─ WindowsKeyboardAdapter → SendInput
```

O controlador central revoga a permissão antes de liberar teclas e botões. Essa fronteira permite
adicionar no futuro portas separadas para clipboard, transferência de arquivos, comandos avançados
e automações sem ampliar implicitamente a permissão de mouse/teclado.

## Biblioteca nativa

O projeto continua usando `koffi@3.1.2`, já incluído pela Beta-5B. O adaptador de teclado chama
`SendInput` de `user32.dll` com códigos virtuais do Windows. Nenhuma dependência nova foi adicionada;
a configuração `asarUnpack` existente continua válida.

## Fluxo de autorização

1. Professor e aluno precisam estar autenticados e associados à mesma sessão ativa.
2. O professor envia `remote-control:request`.
3. O backend registra uma autorização pendente isolada por `sessionId` e `requestId`.
4. O aluno vê que mouse, teclado e atalhos serão liberados.
5. Ao permitir, o aluno valida o compartilhamento e inicia os dois executores.
6. Somente depois disso o backend muda a autorização para ativa.
7. Eventos são encaminhados exclusivamente do socket do professor para o socket do aluno.
8. Qualquer parada revoga mouse, teclado e atalhos em conjunto.

## Teclas e atalhos

O mapeamento inclui letras, linha numérica, teclado numérico, Espaço, Backspace, Delete, Tab, Enter,
Esc, Shift, Ctrl, Alt e Meta/Windows.

São identificados e registrados:

- Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A;
- Ctrl+Z, Ctrl+Y;
- Ctrl+S, Ctrl+F, Ctrl+P, Ctrl+N, Ctrl+O;
- Ctrl+Shift+Esc;
- Ctrl+Alt+Delete.

`Ctrl+Alt+Delete` é a sequência de atenção segura do Windows e não pode ser gerada por `SendInput`.
O evento recebe log `Shortcut` com `supported: false` e o controle continua ativo. Se o sistema
operacional interceptar a combinação ainda no computador do professor, nenhum aplicativo pode
capturá-la.

## Encerramento e erros

A entrada remota termina ao ocorrer ação de qualquer participante, fim da sessão ou do
compartilhamento, desconexão, perda do socket, perda de foco/visibilidade no professor, fechamento da
janela ou erro da biblioteca nativa. Teclas e botões ainda pressionados são liberados durante o
encerramento. Falha de execução gera `reason: execution-error` para sincronizar os dois lados.

Os logs incluem `KeyDown`, `KeyUp`, `KeyPress`, `Shortcut`, `Controle iniciado`,
`Controle encerrado` e `Erro de execução`, além dos eventos de mouse existentes.

## Interface

- Aluno: mantém a barra verde **Controle Remoto Ativo** e o botão para parar imediatamente.
- Professor: mostra o estado geral e indicadores separados para **Mouse** e **Teclado**.
- O diálogo de consentimento informa que mouse, teclado e atalhos serão liberados; arquivos e
  clipboard continuam bloqueados.

## Evidências automatizadas

Os testes cobrem captura e serialização de teclado, transporte Socket.IO de `keydown` e `keypress`,
Espaço sem normalização indevida, bloqueio antes da autorização, mapeamento de teclas, atalhos,
limitação segura de Ctrl+Alt+Delete, ausência de duplicação por `keypress` e liberação imediata ao
encerrar. Os testes Beta-5B continuam cobrindo mouse, monitores, escala e falhas nativas.

Comandos de aceite:

```bash
npm run build
npx turbo run build
```
