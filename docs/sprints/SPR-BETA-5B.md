# SPRINT BETA-5B — Implementação segura do controle remoto do mouse

## Escopo entregue

A Beta-5B executa exclusivamente ações de mouse no computador do aluno após autorização explícita:

- movimento;
- botão esquerdo e direito, com `mousedown` e `mouseup`;
- duplo clique, formado pelas duas sequências reais de pressionar/soltar e identificado pelo evento
  `dblclick` para auditoria sem duplicar a injeção;
- rolagem vertical e horizontal.

Não há execução de teclado, atalhos, área de transferência, arquivos ou automações. O canal de
teclado da Beta-5A continua compatível apenas para transporte/auditoria; o `RemoteControlClient` não
registra listeners de teclado e o executor nativo não expõe nenhuma operação de teclado.

## Biblioteca nativa

No Windows, o adaptador usa `koffi@3.1.2` para chamar diretamente `SetCursorPos` e `SendInput` de
`user32.dll`. O Koffi usa Node-API, fornece binário Windows x64 pré-compilado e foi configurado para
ficar fora do ASAR no pacote Electron.

Essa escolha mantém baixa latência e reduz a superfície do executor às quatro operações da interface
`RemoteMouseAdapter`: mover, pressionar, soltar e rolar. A composição valida `process.platform`; novos
adaptadores macOS/Linux podem implementar a mesma interface sem alterar autorização, transporte ou
interface.

Referências:

- [Koffi — plataformas e arquitetura](https://koffi.dev/)
- [Koffi — exemplo oficial com SendInput](https://koffi.dev/composites)

## Arquitetura

```text
Professor renderer
  RemoteControlClient
  └─ coordenada dentro da imagem do <video> (0..1)
       │ IPC tipado
       ▼
Professor main ── remote-control:mouse ──► Backend Socket.IO
                                             │ sessão + papel + autorização
                                             ▼
Aluno main
  RemoteControlReceiver
  └─ valida sessionId/requestId ativos
       ▼
  RemoteMouseController
  ├─ consulta o desktop virtual com todos os monitores
  ├─ converte 0..1 → pixels físicos
  ├─ evita lacunas entre monitores
  └─ WindowsMouseAdapter → SetCursorPos/SendInput

Aluno renderer
  capturas individuais dos monitores
  └─ canvas do desktop virtual → uma faixa WebRTC para o professor
```

O executor fica no processo principal do Electron. O renderer do aluno não recebe acesso ao Koffi,
às DLLs do sistema nem a uma API genérica de automação.

## Captura automática, coordenadas, resolução e escala

O aluno não precisa selecionar uma tela. Depois de uma ação explícita de **Compartilhar Todas as
Telas** ou **Permitir**, o processo principal enumera somente fontes do tipo `screen`, relaciona cada
`display_id` ao `Display` correspondente e autoriza uma chamada de captura por monitor. Janelas de
aplicativos nunca entram nessa lista.

No renderer, `AllScreensCompositeCapture` posiciona as capturas individuais em um canvas que
representa o desktop virtual. O canvas preserva a proporção do conjunto e limita a faixa WebRTC a
3840 × 2160, reduzindo apenas quando necessário. Para o professor, continua existindo uma única
faixa de compartilhamento.

O `ScreenCaptureTargetRegistry` conserva a origem e as dimensões físicas de todos os monitores.
Coordenadas negativas, escalas do Windows e disposições horizontais ou verticais fazem parte do
desktop virtual.

No professor, a normalização usa somente a imagem realmente renderizada no vídeo. Barras geradas por
`object-fit: contain` são descartadas. A conversão no aluno usa:

```text
x = origemX + round(normalizedX × (larguraFísica - 1))
y = origemY + round(normalizedY × (alturaFísica - 1))
```

Isso cobre Full HD, QHD, 4K, monitores com origem negativa e escala do Windows. Caso a disposição
física deixe uma lacuna no retângulo do desktop virtual, o ponto é ajustado para o pixel válido mais
próximo de um monitor. A captura de uma janela isolada não é oferecida.

## Fluxo de autorização

1. O professor solicita o controle na sessão ativa.
2. O backend confirma professor, aluno e sessão e registra uma autorização pendente.
3. O aluno recebe “O professor deseja controlar seu computador.”.
4. Ao clicar **Permitir**, se ainda não houver compartilhamento, o aplicativo prepara e captura
   automaticamente todos os monitores conectados, sem exibir um seletor.
5. Somente após todas as capturas estarem prontas, o aluno valida o desktop virtual e inicializa o
   executor.
6. Só depois dessa validação o aluno emite `remote-control:approved`.
7. O professor começa a capturar mouse somente depois de receber o aceite.
8. **Negar** remove a autorização sem inicializar o executor.

## Encerramento seguro

O controle é interrompido e os botões eventualmente pressionados são liberados quando ocorre:

- ação **Parar controle** do aluno;
- ação **Encerrar Controle** do professor;
- fim do compartilhamento;
- fim do atendimento;
- desconexão de qualquer participante;
- perda de foco/visibilidade do aplicativo do professor;
- erro de `SetCursorPos` ou `SendInput`;
- descarte/fechamento do aplicativo.

O backend guarda os dois IDs de socket da autorização. Assim, ele consegue revogar e notificar o
outro participante mesmo quando o `PresenceManager` já processou a desconexão.

## Interface

- Aluno: barra fixa verde com “Controle Remoto Ativo”, nome do professor e botão **Parar controle**.
- Professor: indicador ativo e botão **Encerrar Controle** no painel já existente.
- A confirmação informa explicitamente que apenas o mouse será controlado e que teclado, arquivos e
  área de transferência permanecem bloqueados.

## Logs

São registrados:

- `Controle iniciado`;
- `Controle encerrado`;
- `MouseMove`;
- `ClickLeft`;
- `ClickRight`;
- `DoubleClick`;
- `Wheel`;
- `Erro de execução`.

Eventos de teclado preservados do canal anterior recebem a marca “somente log, não executado”.

## Testes e evidências

Os testes automatizados cobrem:

- bloqueio antes da autorização;
- conversão normalizada para monitor QHD/4K, inclusive offset negativo;
- composição proporcional de vários monitores em uma única faixa;
- correspondência e ordem das fontes pelo `display_id`;
- mapeamento no desktop virtual e proteção contra lacunas entre monitores;
- movimento, botões esquerdo/direito, rolagem e liberação de botão ao parar;
- erro nativo com parada e `execution-error`;
- ausência de captura de teclado no professor;
- descarte das barras fora da imagem compartilhada;
- parada por perda de foco;
- isolamento por sessão/papel no backend;
- `dblclick` no protocolo;
- revogação por sessão e por desconexão.

Comandos obrigatórios:

```bash
npm run build
npx turbo run build
```

O empacotamento Windows também deve validar a presença do binário Koffi no `app.asar.unpacked` e
gerar novamente o instalador do aluno.
