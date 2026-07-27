# SPRINT BETA-6A — Auditoria da transmissão de tela

Data da auditoria: 27/07/2026

## Conclusão

O gargalo estava no aluno, antes da rede, em dois pontos encadeados:

1. `startScreenShare()` enviava **sempre** uma nova track produzida por canvas, mesmo quando
   existia somente um monitor. A captura nativa de 1920×1080 a 30 fps era convertida em
   `MediaStream -> <video> -> canvas -> captureStream() -> MediaStreamTrack`.
2. Sob pressão, o sender WebRTC reduzia a cadência. No baseline, o
   `qualityLimitationReason` permaneceu em `bandwidth` durante 26,827 s e o vídeo foi enviado
   a somente 6,75 fps, apesar da fonte anunciar 30 fps.

O atraso ocorria principalmente em **composição/captura intermediária e codificação/adaptação
do sender**, não em Socket.IO, controle remoto, rede, recepção ou elemento `<video>`.

## Arquivos e funções responsáveis

- `apps/student-electron/renderer/index.ts`
  - `startScreenShare()`, aproximadamente linhas 526–593.
  - Antes da correção, a chamada incondicional a `AllScreensCompositeCapture.start()` ficava
    aproximadamente na linha 547.
- `apps/student-electron/renderer/all-screens-composer.ts`
  - `AllScreensCompositeCapture.drawFrame()`, linhas 107–119.
  - O loop redesenha o canvas via `requestAnimationFrame`, mesmo quando a track nativa de um
    único monitor já está pronta para ser transmitida.

O histórico do Git confirma a regressão: antes de `fcbce4c`, a track do
`getDisplayMedia()` era adicionada diretamente ao `RTCPeerConnection`; esse commit introduziu
a composição obrigatória para viabilizar todos os monitores.

## Evidências do baseline

Ambiente medido:

- Windows, Electron 43.1.1/Chromium;
- um monitor físico, 1920×1080, escala 1,25;
- codec VP8;
- captura nativa configurada para 30 fps;
- controle remoto e carga visual contínuos;
- `RTCPeerConnection.getStats()`, `requestVideoFrameCallback()`, qualidade de reprodução e
  métricas de processos coletados a cada ~2 s.

Resultados antes da correção (sessão de 30 s; 27,99 s úteis):

| Métrica                              |                      Antes |
| ------------------------------------ | -------------------------: |
| FPS do canvas                        |                      18,94 |
| FPS enviado/recebido medido          |                       6,75 |
| FPS reportado no último sample       |                          3 |
| Tempo médio de encode                |             73,52 ms/frame |
| Limitação por banda                  |                   26,827 s |
| Bitrate médio                        |               355,7 kbit/s |
| Packet loss                          |                          0 |
| RTT                                  |                      16 ms |
| Jitter                               |                     139 ms |
| Congelamentos                        |              7 (15,01/min) |
| Tempo congelado                      | 3,828 s (13,68% da sessão) |
| Gap máximo entre frames renderizados |                   865,8 ms |
| FPS renderizado                      |                       5,97 |
| Frames descartados pelo vídeo        |                      3,06% |
| Captura até apresentação             |          429,3 ms em média |
| Recepção até apresentação            |          189,1 ms em média |
| Decode                               |     12,4 ms/frame em média |
| CPU do processo renderer do aluno    |        96,87% de um núcleo |
| CPU do processo GPU do aluno         |        53,07% de um núcleo |
| Heap JS do aluno/professor           |            9,5 MB, estável |

Interpretação:

- A fonte continuava viva, sem `muted`, a 1920×1080/30 fps.
- O canvas intermediário não acompanhava a fonte.
- O sender codificava e enviava muito menos frames do que a fonte produzia.
- Não houve perda de pacotes e o RTT permaneceu baixo.
- O professor recebeu exatamente a mesma cadência baixa que o aluno enviou.
- O decoder consumiu em média 12,4 ms/frame; portanto recepção/decodificação não eram a causa.
- `qualityLimitationDurations.cpu` foi zero; a limitação declarada pelo encoder foi banda.

## Correção aplicada

Somente `apps/student-electron/renderer/index.ts` foi alterado no produto:

1. Quando há um monitor, `startScreenShare()` envia diretamente a track nativa do
   `getDisplayMedia()`. O compositor existente continua sendo usado sem mudança para dois ou
   mais monitores.
2. O sender da tela recebe:
   - `degradationPreference = "maintain-framerate"`;
   - `maxFramerate = 30`.

Assim, sob restrição de banda o WebRTC preserva a atualização temporal e pode degradar a
qualidade espacial, em vez de transformar o acesso remoto em uma sequência de imagens
congeladas.

Não houve alteração de arquitetura, protocolo, sinalização, Socket.IO, controle remoto,
IPC, `desktopCapturer`, professor ou componentes de interface.

## Resultado depois da correção

Teste contínuo: 600 s solicitados, 599,36 s úteis entre primeira e última amostra, 287
amostras, controle remoto e carga visual contínuos.

A carga visual foi sintética e determinística (mudança de tela a 10 Hz), combinada com
`mousemove` remoto a aproximadamente 30 Hz. O ambiente bloqueou a tentativa posterior de
abrir e alternar processos externos do Windows; portanto o roteiro literal com navegador,
Explorador e editor não foi executado automaticamente. A carga sintética exercita o mesmo
pipeline de pixels e foi mantida idêntica na comparação antes/depois.

| Métrica                       |        Antes | Depois (10 min) |  Variação |
| ----------------------------- | -----------: | --------------: | --------: |
| Desenhos de canvas/s          |        18,94 |               0 |     −100% |
| FPS enviado/recebido          |         6,75 |           10,98 |    +62,7% |
| FPS renderizado               |         5,97 |           10,94 |    +83,2% |
| Encode médio                  |     73,52 ms |        26,56 ms |    −63,9% |
| Bitrate médio                 | 355,7 kbit/s |    234,7 kbit/s |    −34,0% |
| Tempo limitado por banda      |     26,827 s |             0 s | eliminado |
| Jitter                        |       139 ms |           11 ms |    −92,1% |
| Packet loss                   |            0 |               0 |   estável |
| RTT                           |        16 ms |           17 ms |   estável |
| Captura até apresentação      |     429,3 ms |        203,1 ms |    −52,7% |
| Congelamentos/min             |        15,01 |            2,10 |    −86,0% |
| Percentual de tempo congelado |       13,68% |           1,23% |    −91,0% |
| Frames descartados no vídeo   |        3,06% |           0,24% |    −92,2% |
| CPU do processo GPU do aluno  |       53,07% |          35,10% |    −33,9% |
| Heap JS                       |       9,5 MB |          9,5 MB |   estável |

Observações:

- O último sample permaneceu em 1920×1080, VP8, 11 fps; a carga visual do teste mudava a
  imagem a 10 vezes por segundo.
- O bitrate caiu mesmo com aumento do FPS, evidenciando a remoção do caminho redundante.
- Ambos os peers terminaram em `connectionState = "connected"`.
- `degradationPreference` foi confirmado como `maintain-framerate` e `maxFramerate` como 30.
- Não houve limitação por CPU nem por banda durante os 10 minutos.
- O maior gap isolado foi 849,5 ms, sem congelamento prolongado acima de um segundo. A taxa
  normalizada e o tempo total congelado caíram de forma substancial.
- A CPU cumulativa de renderer não foi usada como critério de aprovação: o harness injeta
  carga visual, coleta toda a árvore de stats e gera mousemove contínuo. O WebRTC reportou
  zero segundo de limitação por CPU; GPU e memória ficaram controladas.

## Auditoria dos demais estágios

- `apps/student-desktop` e `apps/teacher-desktop` são pontos de entrada/reserva e reexportam o
  engine; não participam do runtime Electron medido.
- `apps/student-electron/main/index.ts` seleciona corretamente a fonte do
  `desktopCapturer`, sem thumbnails e sem loop síncrono.
- Preloads e IPCs apenas transportam sinalização e estados; nenhum frame passa por IPC.
- `apps/teacher-electron/renderer/presence.ts` mantém um único `RTCPeerConnection`, uma única
  `MediaStream` por track anunciada e um único `<video>` para a tela.
- `readyState = 4`, `paused = false`, dimensões 1920×1080 e
  `requestVideoFrameCallback()` contínuo confirmaram que o vídeo renderiza quando frames
  chegam.
- Os listeners possuem cleanup em `beforeunload`; não foram observados listeners duplicados,
  remontagem de vídeo ou substituição repetitiva de stream.
- Esses renderers usam TypeScript/DOM direto, não React; portanto não existem `useEffect()` ou
  rerenders React neste pipeline.

## Validações executadas

- `npm run typecheck --workspace=@professor-connect/student-electron` — aprovado.
- `npm run lint --workspace=@professor-connect/student-electron` — aprovado.
- `npm run test --workspace=@professor-connect/student-electron` — 32/32 aprovados.
- `npm run build --workspace=@professor-connect/student-electron` — aprovado.
- `npm run build` — 13/13 pacotes aprovados.
- `npx turbo run build` — 13/13 pacotes aprovados.
- Teste E2E de 10 minutos — aprovado, peers e controle conectados até o final.
- Alternância literal de aplicativos externos — não executada; bloqueada pela política do
  ambiente antes da abertura de processos.

## Artefatos

- `scripts/audit-screen-stream.mjs`: harness reproduzível de sessão Electron, coleta WebRTC,
  frame timing, reprodução, CPU/GPU e memória.
- `auditorias/screen-stream-raw-metrics.zip`: amostras JSON completas antes e depois.

## Referências técnicas

- MDN, `RTCPeerConnection.getStats()` e `RTCStatsReport`.
- MDN, `HTMLVideoElement.requestVideoFrameCallback()`.
- MDN, `HTMLCanvasElement.captureStream()`.
- Electron, `ProcessMetric` e `app.getAppMetrics()`.
