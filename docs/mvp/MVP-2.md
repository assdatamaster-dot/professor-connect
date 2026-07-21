# MVP-2 — Desktop Teacher Application

## Objetivo

O MVP-2 entrega a primeira interface desktop do professor em Electron. Ela apresenta alunos online,
recebe solicitações de atendimento e comanda o ciclo integrado através do `WorkflowManager`, sem
acessar diretamente Socket.IO, WebRTC, `RTCPeerConnection` ou RTC Engine.

Não fazem parte desta entrega novas regras de autenticação, execução real de controle remoto, chat,
gravação, arquivos ou suporte a múltiplos participantes.

## Estrutura

De acordo com a arquitetura do monorepo definida na Sprint A-1, o módulo solicitado como desktop do
professor é um workspace em `apps/teacher-electron`:

```text
apps/teacher-electron/
├── main/
│   ├── index.ts                        # ciclo de vida do Electron
│   ├── ipc.ts                          # handlers IPC e validação do sender
│   ├── teacher-workflow.controller.ts  # tradução Workflow → apresentação
│   ├── teacher-workflow.manager.ts     # fachada do perfil sobre WorkflowManager
│   ├── window-options.ts               # configuração segura e testável
│   └── workflow-composition.ts         # composição das portas do Workflow
├── preload/
│   └── index.ts                        # API mínima por contextBridge
├── renderer/
│   ├── index.html
│   ├── index.ts
│   ├── styles.css
│   ├── i18n.ts
│   └── view-model.ts
├── shared/
│   ├── contracts.ts                    # snapshots e API tipados
│   └── ipc-channels.ts                 # canais IPC centralizados
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
      │ TeacherWorkflowApi
      ▼
Preload + contextBridge
      │ IPC tipado
      ▼
TeacherWorkflowController
      │ TeacherWorkflowManagerPort
      ▼
TeacherWorkflowManager
      │ WorkflowManagerPort
      ▼
Workflow Manager da Sprint 15
```

O renderer conhece apenas os contratos de apresentação. O preload não expõe `ipcRenderer` e publica
somente inicialização, aceite, recusa, solicitações opcionais, encerramento e assinatura de estado.
O processo principal valida o `WebContents` remetente e os identificadores antes da delegação.

`TeacherWorkflowManager` adapta a visão de presença e Requests para o perfil do professor. Ao
aceitar uma solicitação, ele monta o par aluno/professor e usa o `WorkflowManagerPort` existente para
executar todo o fluxo integrado. Compartilhamento e controle remoto também são delegados à mesma
fachada. Nenhuma lógica de Socket.IO, signaling ou WebRTC é duplicada na interface.

## Fluxo do professor

1. Electron cria a janela `Professor Connect` e carrega somente arquivos locais.
2. O renderer inicializa a fachada pelo preload.
3. O snapshot conectado apresenta alunos online e Requests pendentes.
4. `Recusar` remove a oferta selecionada e registra a decisão.
5. `Aceitar` correlaciona o aluno e delega o atendimento ao Workflow Manager.
6. O Workflow cria Session e Call, negocia WebRTC/DataChannel e inicia áudio e vídeo.
7. Em `ACTIVE`, os vídeos e controles do atendimento ficam visíveis.
8. O professor pode solicitar compartilhamento de tela ou autorização de controle remoto.
9. `Encerrar Atendimento` executa o teardown do Workflow e libera os recursos.
10. A interface volta ao estado disponível e continua apta a receber atendimentos.

## Estados da apresentação

| Estado            | Significado visual                                |
| ----------------- | ------------------------------------------------- |
| `IDLE`            | aplicação ainda não inicializada                  |
| `AVAILABLE`       | professor conectado e sem Request pendente        |
| `REQUEST_PENDING` | uma ou mais solicitações aguardam resposta        |
| `PREPARING`       | Session, Call, signaling e mídia em preparação    |
| `ACTIVE`          | atendimento ativo e área de vídeo visível         |
| `ENDING`          | liberação de recursos em andamento                |
| `ENDED`           | atendimento finalizado                            |
| `ERROR`           | falha apresentada no status e registrada nos logs |

## Interface, acessibilidade e Dark Mode

A interface usa tema claro, duas colunas em telas amplas e reorganização progressiva abaixo de
1060, 760 e 560 pixels. Listas e logs possuem regiões `aria-live`, botões têm foco visível,
`aria-busy` e estados desabilitados. `prefers-reduced-motion` remove animações.

As cores estão centralizadas em custom properties CSS. O seletor `data-theme="dark"` já possui o
conjunto alternativo de tokens, permitindo adicionar a preferência de tema futuramente sem alterar
componentes ou regras de negócio. O tema claro continua sendo o padrão desta Sprint.

Os textos ficam no catálogo `renderer/i18n.ts`. Um novo idioma deve implementar
`TeacherTranslations` e ser selecionado no ponto de composição do renderer.

## Segurança Electron

- `contextIsolation: true`;
- `nodeIntegration: false`;
- sandbox do renderer habilitado;
- Content Security Policy restritiva;
- navegação e abertura de novas janelas bloqueadas;
- API do preload com superfície mínima;
- remetente validado em cada operação IPC;
- permissão de mídia limitada ao renderer principal.

## Painel de logs

O painel mantém no máximo 100 entradas e registra conexão, Request recebida, aceite, recusa, início
da Call, disponibilidade de vídeo, solicitações de compartilhamento e controle, encerramento e
falhas. Nenhum dado de mídia ou detalhe interno de transporte é exposto.

## Como executar

Na raiz do repositório:

```bash
npm install
npm run desktop:teacher
```

Depois de compilar, também é possível executar diretamente:

```bash
npm run start --workspace=@professor-connect/teacher-electron
```

## Como testar

```bash
npm run typecheck --workspace=@professor-connect/teacher-electron
npm run test --workspace=@professor-connect/teacher-electron
npm run build --workspace=@professor-connect/teacher-electron
```

Os sete testes automatizados cobrem:

1. inicialização e segurança da janela Electron;
2. conexão e listagem de alunos online;
3. recebimento de solicitação;
4. aceite, Call, mídia e controles;
5. recusa e remoção da fila;
6. solicitações de compartilhamento e controle pelo Workflow;
7. encerramento e ocultação dos recursos.

Para validar todos os workspaces, execute `npm run check`.
