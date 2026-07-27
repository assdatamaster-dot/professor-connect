# SPRINT BETA-7A — Transferência profissional de arquivos

Data da validação: 27/07/2026

## Resultado

Foi implementada transferência bidirecional Professor ↔ Aluno durante uma sessão ativa. O conteúdo
dos arquivos trafega exclusivamente por um `RTCDataChannel` confiável e ordenado chamado
`professor-connect-files-v1`. O Socket.IO continua restrito à sinalização WebRTC já existente.

O pipeline de vídeo, os transceivers de áudio/vídeo, o compartilhamento de tela e o controle remoto
não foram alterados. A integração com a conexão existente se resume à criação do DataChannel no
Professor e ao recebimento de `ondatachannel` no Aluno.

## Arquitetura

```text
Renderer Professor                       Renderer Aluno
FileTransferClient ─ RTCDataChannel P2P ─ FileTransferClient
       │                                        │
       │ IPC tipado                             │ IPC tipado
       ▼                                        ▼
Electron Main                            Electron Main
FileTransferStorage                     FileTransferStorage
seletor/leitura/SHA-256                  aceite/gravação/SHA-256
```

- Renderer: coordena pedidos, aceite/recusa, fila, progresso, backpressure, retomada e frames
  binários.
- Preload: expõe somente operações tipadas e limitadas; nenhum caminho local é exposto ao peer.
- Main: usa seletor nativo, valida IPC, lê/grava em disco e traduz erros do sistema operacional.
- Engine Node: contém o armazenamento reutilizável, isolado em
  `@professor-connect/engine/file-transfer-node` para não contaminar pacotes de navegador com APIs
  Node.

## Protocolo e chunks

- Chunk fixo: 64 KiB.
- Janela máxima: 16 chunks em voo.
- Backpressure: pausa o produtor quando `RTCDataChannel.bufferedAmount` ultrapassa 4 MiB.
- Cada frame contém `transferId`, índice e SHA-256 do bloco.
- O conteúdo é lido e gravado bloco a bloco; o arquivo completo nunca é carregado em memória.
- Mensagens JSON do DataChannel carregam apenas controle: request, accept, reject, ack, complete,
  verified, retry, cancel e error.
- Nenhum byte de arquivo foi adicionado a eventos Socket.IO.

## Aceite, destino e duplicidade

- O envio só começa depois do aceite explícito do destinatário.
- A solicitação mostra remetente, nome e tamanho.
- O destino é `%USERPROFILE%\Documents\Professor Connect`.
- Arquivos recebidos usam `.part` até a verificação final.
- Arquivo existente abre diálogo nativo com:
  - Substituir;
  - Renomear automaticamente;
  - Cancelar.
- A substituição preserva o arquivo antigo em backup até o rename final ser concluído.
- Nenhum arquivo é aberto ou executado automaticamente.

## Retomada

- O destino persiste metadados, arquivo parcial e hashes por bloco.
- Em uma reconexão do PeerConnection/DataChannel, o remetente repete o request com o mesmo
  `transferId`.
- O receptor informa o primeiro chunk contíguo ausente e o envio continua desse ponto.
- A varredura incremental evita custo quadrático em arquivos grandes.
- Interrupção do canal muda o item para “Aguardando conexão”; não libera a origem nem apaga o
  parcial.

## Integridade

- SHA-256 completo é calculado na seleção da origem.
- Cada chunk recebe SHA-256 próprio e é validado antes da gravação.
- Antes de concluir, a origem é verificada novamente para detectar alteração durante o envio.
- O destino calcula SHA-256 completo.
- Se houver divergência, o receptor compara os hashes persistidos e solicita apenas os índices
  incorretos.
- A conclusão só é exibida quando o hash final do destino coincide com a origem.

## Segurança

- Nome recebido é reduzido a nome de arquivo e rejeita separadores, nomes vazios, caracteres
  inválidos e caracteres de controle.
- `transferId`, índices, tamanhos, hashes e estruturas IPC/DataChannel são validados.
- Caminhos de retomada precisam permanecer dentro do diretório de recebimento.
- O Renderer não recebe acesso genérico ao filesystem.
- Navegação externa e `window.open` permanecem bloqueados pelas configurações atuais.
- O DataChannel usa a criptografia DTLS do WebRTC.

## Interface

Professor e Aluno receberam:

- botão `📁 Transferir Arquivos`;
- painel da sessão com lista de transferências;
- aceitar, recusar e cancelar;
- percentual visual;
- bytes transferidos/total;
- velocidade;
- ETA;
- estados aguardando, enviando, recebendo, aguardando conexão, concluído, cancelado, recusado e
  falhou.

## Logs

O arquivo `file-transfers.jsonl`, no `userData` de cada aplicativo, registra:

- identificador;
- direção;
- origem;
- destino;
- peer;
- nome;
- tamanho;
- início e fim;
- velocidade média;
- SHA-256;
- resultado e erro, quando houver.

## Testes realizados

Automatizados:

- PDF, DOCX, XLSX, ZIP, PNG, JPG e MP4;
- seleção múltipla;
- chunks com limite de 64 KiB;
- 100 MB, 500 MB, 1 GB e 1,25 GB na preparação sem pré-alocação em memória;
- transferência completa com SHA-256;
- duas transferências simultâneas intercaladas;
- interrupção e retomada do último chunk;
- bloco corrompido e reenvio do bloco;
- substituir, renomear e cancelar duplicidade;
- frames simultâneos e frames adulterados;
- regressão completa de WebRTC, mídia, tela, controle remoto e workflows existentes.

Auditoria física adicional:

- arquivo de 100 MiB;
- 1.600 chunks;
- hash origem/destino:
  `20492a4d0d84f8beb1767f6616229f85d44c2827b64bdbfb260ee12fa1109e0e`;
- integridade: válida;
- tempo: 5.756 ms;
- média local de armazenamento: 17,37 MiB/s;
- crescimento observado de RSS: 12 MiB.

Evidência: `auditorias/beta-7a-file-transfer.json`.

Comandos concluídos:

- `npm run lint`: 13/13 tarefas;
- `npm run typecheck`: 13/13 tarefas;
- `npm test`: 11/11 tarefas;
- `npm run build`: 13/13 tarefas;
- `npx turbo run build`: 13/13 tarefas.

## Executáveis

Aluno:

- `release/student/Professor-Connect-Aluno-Setup-0.1.0-x64.exe`
- SHA-256: `BCC5BF4B43C8A5B965292F3EF14FE73A2C32A04D3F9B6BAB055F8DEDE89B3FAB`

Professor:

- `release/teacher/Professor-Connect-Professor-Setup-0.1.0-x64.exe`
- SHA-256: `A05A5CD8E8ECEA5C231B4F232C918CF3E847E17F7D20024F5822F9C6E5B704A9`

## Limitações conhecidas

- A retomada automática cobre reconexão de rede/PeerConnection e mantém o parcial no receptor. Se o
  aplicativo remetente for totalmente encerrado, a seleção de origem em memória é perdida e o
  usuário precisa selecionar novamente o arquivo.
- A auditoria física automatizada foi executada com 100 MiB. Os limites de 500 MiB, 1 GiB e
  1,25 GiB foram validados sem alocar o arquivo completo e usam exatamente o mesmo laço de chunks,
  mas não foram materializados integralmente nessa execução.
- Os instaladores continuam sem assinatura Authenticode (`NotSigned`), comportamento já existente
  no projeto.
- Drag-and-drop, sincronização de pastas e fila persistente entre reinícios não fazem parte desta
  sprint, mas o protocolo por `transferId` e o armazenamento modular deixam esses recursos
  extensíveis.
