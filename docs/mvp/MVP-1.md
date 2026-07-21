# MVP-1 — Desktop Student Application

## Objetivo

O MVP-1 entrega a primeira interface desktop do aluno em Electron. Ela apresenta e comanda o ciclo
de atendimento já definido pelo `WorkflowManager`, sem acessar diretamente Socket.IO, WebRTC,
`RTCPeerConnection` ou RTC Engine.

Continuam fora do escopo: interface do professor, login, banco, chat, gravação, transferência de
arquivos, múltiplos participantes e execução real de mouse/teclado.

## Estrutura

```text
apps/student-electron/
├── main/
│   ├── index.ts                       # ciclo de vida do Electron
│   ├── ipc.ts                         # handlers IPC e validação do sender
│   ├── student-workflow.controller.ts # tradução Workflow → apresentação
│   ├── window-options.ts              # configuração testável da janela
│   └── workflow-composition.ts        # composição do WorkflowManagerPort
├── preload/
│   └── index.ts                       # API mínima via contextBridge
├── renderer/
│   ├── index.html
│   ├── index.ts
│   ├── styles.css
│   ├── i18n.ts
│   └── view-model.ts
├── shared/
│   ├── contracts.ts                   # snapshots e API tipados
│   └── ipc-channels.ts                # canais centralizados do processo main
├── assets/
├── tests/
└── scripts/
```

## Arquitetura

```text
Interface HTML/CSS
      │ ações e snapshots
      ▼
Renderer TypeScript
      │ DesktopWorkflowApi
      ▼
Preload + contextBridge
      │ IPC tipado
      ▼
StudentWorkflowController
      │ WorkflowManagerPort
      ▼
Workflow Manager da Sprint 15
```

O renderer conhece apenas contratos de apresentação. O preload não expõe `ipcRenderer`; ele
publica quatro operações delimitadas e uma assinatura de snapshots. O processo principal valida a
origem de cada chamada IPC antes de delegar ao controller.

`StudentWorkflowController` é um adaptador de apresentação. Ele não recria as regras de Request,
Call, mídia ou compartilhamento: chama o manager e traduz estados/eventos para um snapshot adequado
à tela. Essa inversão permite substituir a composição técnica sem alterar a UI.

## Fluxo da interface

1. Electron cria a janela `Professor Connect` e carrega somente arquivos locais.
2. O renderer pede o snapshot inicial pelo preload.
3. `CHAMAR PROFESSOR` chama `WorkflowManager.begin()`.
4. `CONNECTING` mostra conexão em andamento; `REQUESTED` mostra espera pelo professor.
5. Quando o workflow processa o aceite, `PREPARING` e `NEGOTIATING` atualizam a mensagem.
6. Em `ACTIVE`, a área de vídeo local/remoto e os controles ficam visíveis.
7. `Compartilhar Tela` delega a `WorkflowManager.startScreenSharing()`.
8. `Encerrar Atendimento` delega a `WorkflowManager.end()`.
9. `COMPLETED` oculta mídia, limpa os estados visuais e permite novo atendimento.
10. `FAILED` apresenta erro e o registra no painel.

## Estados da apresentação

| Estado       | Significado visual                             |
| ------------ | ---------------------------------------------- |
| `IDLE`       | aplicação pronta para uma nova solicitação     |
| `REQUESTING` | conexão e criação da Request em andamento      |
| `WAITING`    | Request criada; aguardando aceite              |
| `PREPARING`  | Session, Call, signaling e mídia em preparação |
| `ACTIVE`     | atendimento ativo e área de vídeos visível     |
| `ENDING`     | liberação de recursos em andamento             |
| `ENDED`      | atendimento concluído                          |
| `ERROR`      | falha apresentada e registrada                 |

## Interface e acessibilidade

A interface usa tema claro, duas colunas em telas largas e uma coluna abaixo de 920 px. Os botões
possuem foco visível, estados disabled e `aria-busy`; mudanças de atendimento e logs usam regiões
`aria-live`. A preferência `prefers-reduced-motion` desativa transições.

O catálogo inicial está em `renderer/i18n.ts`. Para adicionar idioma, deve-se implementar um novo
`DesktopTranslations` e selecioná-lo no ponto de composição da apresentação.

## Segurança Electron

- `contextIsolation: true`;
- `nodeIntegration: false`;
- sandbox do renderer habilitado;
- Content Security Policy restritiva;
- bloqueio de navegação e abertura de novas janelas;
- API do preload com superfície mínima;
- validação do `WebContents` remetente nos handlers IPC;
- permissão limitada a mídia do renderer principal.

## Painel de logs

O painel mantém no máximo 100 entradas e registra:

- conexão e inicialização;
- criação/aceite da Request;
- criação e encerramento da Call;
- disponibilidade de áudio/vídeo;
- compartilhamento de tela;
- falhas do workflow ou de ações da interface.

## Como executar

Na raiz do repositório:

```bash
npm install
npm run desktop:student
```

O comando compila main, preload e renderer e abre o Electron. Depois de compilar, a execução direta
do workspace é:

```bash
npm run start --workspace=@professor-connect/student-electron
```

## Como testar

```bash
npm run typecheck --workspace=@professor-connect/student-electron
npm run test --workspace=@professor-connect/student-electron
npm run build --workspace=@professor-connect/student-electron
```

Os testes automatizados cobrem:

1. configuração segura e estado inicial da janela;
2. conexão, criação da Request e mudança para espera;
3. aceite, estado ativo e exibição da mídia/controles;
4. encerramento e ocultação dos recursos da chamada.

Para validar o monorepo completo, execute `npm run check`.
