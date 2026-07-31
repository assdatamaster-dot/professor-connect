# SPRINT BETA-9A — Auditoria geral de arquitetura, qualidade, performance e estabilização

Data: 30/07/2026  
Escopo: monorepo completo do Professor Connect  
Estado do repositório no início: `main`, alinhado a `origin/main`, árvore de trabalho limpa

## 1. Conclusão executiva

O projeto possui uma base TypeScript consistente, testes relevantes para os fluxos críticos, boa
proteção do processo Renderer do Electron, validação de IPC, isolamento do controle remoto e uma
implementação de transferência de arquivos cuidadosa com memória e integridade.

Apesar disso, **o sistema não deve ser liberado para produção aberta à Internet no estado
auditado**. Há três bloqueios estruturais:

1. não existe autenticação de pessoas ou dispositivos nas APIs HTTP e conexões Socket.IO;
2. o runtime do backend é integralmente volátil e não utiliza o workspace de banco de dados;
3. os clientes Electron reais usam apenas STUN público e não recebem a configuração TURN já
   modelada no `engine`.

Também foi confirmado um defeito alto e corrigível sem alterar UX: uma sessão ativa não era
encerrada no servidor quando professor ou aluno perdiam a conexão. O cliente limpava o estado local,
mas o backend mantinha a sessão indefinidamente como ativa.

Esta auditoria foi concluída e documentada antes de qualquer alteração de código. As correções desta
Sprint permanecem restritas a problemas altos que podem ser resolvidos sem inventar requisitos de
identidade, retenção ou infraestrutura.

## 2. Método e abrangência

Foram inspecionados:

- 13 workspaces npm;
- 257 arquivos de código e interface;
- 36.905 linhas em TypeScript, JavaScript, HTML e CSS;
- API Express, serviços de domínio, dois conjuntos de gateways Socket.IO e estado em memória;
- processos Main, Preload e Renderer dos dois aplicativos Electron;
- sinalização e renegociação WebRTC, ICE restart, mídia e troca de dispositivos;
- compartilhamento de tela simples e múltiplos monitores;
- controle remoto, IPC e adapters nativos de mouse/teclado;
- transferência de arquivos, backpressure, retomada e verificação SHA-256;
- Prisma, Docker, Compose, Nixpacks, Turbo, TypeScript, ESLint e empacotamento Electron;
- testes e evidências das auditorias BETA-6A, BETA-6C, BETA-7A e BETA-8B.

Verificações automatizadas executadas antes das correções:

- `npm audit --omit=dev --json`: 0 vulnerabilidades conhecidas;
- `npm ls --all --omit=optional`: grafo instalado consistente;
- `npx turbo run test --force --summarize`: 114/114 testes aprovados, sem cache;
- `npm run build`: 13/13 workspaces aprovados;
- `npx turbo run build --force`: 13/13 workspaces aprovados, sem cache;
- ESLint: 13/13 workspaces aprovados;
- TypeScript: 13/13 workspaces aprovados;
- busca automatizada de ciclos entre imports relativos de produção: nenhum ciclo;
- busca por `TODO`, `FIXME`, `HACK` e `XXX`: nenhum marcador pendente no código de produção.

Limitações do ambiente:

- Docker não está instalado nesta estação; o Dockerfile e os arquivos Compose foram auditados
  estaticamente, mas a imagem não pôde ser construída localmente;
- não foi possível reproduzir fisicamente suspensão de notebook, troca de DPI, desconexão USB e
  sessões de quatro horas nesta execução;
- as evidências reais anteriores cobrem 10 minutos de mídia/controle contínuos, ciclos de
  minimizar/restaurar, monitor 4K e transferências grandes, mas não substituem soak tests de 4–24 h;
- instaladores não foram reconstruídos porque a correção planejada pertence apenas ao backend.

## 3. Arquitetura observada

O grafo principal respeita a direção geral `apps -> engine/protocol -> services`. Não foram
encontradas dependências circulares entre imports relativos.

Entretanto, há duas arquiteturas de comunicação simultâneas no mesmo servidor:

- a arquitetura histórica baseada em `CommunicationGateway`, `SocketMessage`, `EventType`,
  `HeartbeatService`, `RequestService`, `CallService` e `SessionService`;
- a arquitetura usada pelos Electron atuais, baseada em eventos literais
  `professor:*`, `student:*`, `session:*`, `webrtc:*` e managers paralelos.

O segundo fluxo é o usado pelo produto visível. O primeiro continua inicializado, mantém timers e
estado próprios e amplia superfície de ataque e manutenção. Os workspaces `shared`, `ui`,
`database`, `student-desktop` e `teacher-desktop` também não participam do runtime Electron atual.

Não há React no frontend ativo. Os Renderers usam TypeScript e DOM direto; portanto problemas de
hooks não se aplicam. Em compensação, os principais Renderers são monolíticos:

- `apps/student-electron/renderer/index.ts`: 992 linhas;
- `apps/teacher-electron/renderer/presence.ts`: 917 linhas;
- cada `file-transfer.client.ts`: 988 linhas e praticamente duplicado;
- CSS principal: 1.581 e 1.626 linhas.

## 4. Problemas encontrados e classificação

### Críticos

#### C-01 — Ausência de autenticação e identidade confiável

**Áreas:** segurança, backend, Socket.IO, API, controle remoto  
**Evidência:** os gateways aceitam nome, papel e identificador enviados pelo próprio socket. As
rotas `/api/professors/online`, `/api/students/online` e `/api/sessions/*` são públicas. Não há
middleware de autenticação, token de sessão, matrícula de dispositivo ou autorização de rota.

O gateway de controle remoto valida corretamente sessão, papel, `requestId` e aprovação do aluno,
mas a identidade que entra na sessão não é autenticada. Um cliente arbitrário pode se apresentar
como aluno ou professor e consultar metadados de presença e sessões.

**Impacto:** personificação, exposição de nomes e histórico, criação abusiva de solicitações e risco
de engenharia social para obter consentimento de controle remoto.

**Decisão nesta Sprint:** não corrigido. Uma chave estática embutida no Electron seria extraível e
criaria falsa segurança. A correção exige um fluxo real de identidade/dispositivo, emissão de
credenciais curtas, autorização por papel e revogação. É bloqueio de produção pública.

### Altos

#### A-01 — Backend volátil e banco de dados desconectado do runtime

`@professor-connect/database` contém um Prisma Client e um schema sem modelos. Nenhum workspace de
runtime depende dele. Presença, solicitações, sessões, chamadas e históricos vivem em `Map`.

**Impacto:** restart/deploy perde histórico e estado; não há integridade transacional; duas réplicas
divergiriam imediatamente; não existe estratégia de backup ou retenção.

**Decisão:** não corrigido. Exige modelo de dados, migrações, política de retenção e decisão sobre o
que deve sobreviver a uma sessão. É bloqueio de produção e de escalabilidade horizontal.

#### A-02 — TURN configurável não é usado pelos clientes reais

O `engine` possui `loadWebRtcIceSettings` e testes de STUN/TURN, mas os Renderers ativos criam
`RTCPeerConnection` com `stun:stun.l.google.com:19302` fixo. As variáveis `WEBRTC_TURN_*` do backend
não chegam ao Electron.

**Impacto:** falha de áudio, vídeo, tela, controle e arquivos em NAT simétrico, redes corporativas,
CGNAT restritivo ou bloqueio de UDP.

**Decisão:** não corrigido sem um serviço TURN e estratégia segura para credenciais efêmeras.
Credenciais TURN permanentes em `config.json` não são aceitáveis para produção.

#### A-03 — Sessões órfãs após desconexão

O `SessionGateway` auditado tratava apenas `session:end`. Os gateways de presença removiam o
participante em `disconnect`, mas `SessionManager.activeSessions` não era atualizado. Os clientes
Electron limpavam `activeSession` localmente, impossibilitando encerrar depois a entrada presa.

**Impacto:** API informa sessões inexistentes como ativas, histórico fica inconsistente e memória
cresce. Em uso contínuo, quedas de rede acumulam registros órfãos.

**Correção planejada:** registrar os sockets participantes ao criar a sessão e finalizar todas as
sessões daquele socket no evento `disconnect`, notificando o participante remanescente e os
listeners de controle remoto.

#### A-04 — Reconexão oficial não cobre o fluxo Electron em produção

O fluxo histórico possui janela de recuperação em `HeartbeatService`, mas os Electron atuais usam
os gateways paralelos de presença. Ao perder Socket.IO, ambos limpam a sessão local; ao reconectar,
o professor recebe um novo UUID e a sessão anterior não é restaurada.

**Impacto:** os cenários “professor perde internet”, “aluno perde internet”, suspensão e retorno não
retomam o atendimento. O ICE restart do professor recupera mídia apenas enquanto a sinalização e a
sessão Socket.IO continuam válidas.

**Decisão:** não corrigido nesta Sprint. Requer consolidar os protocolos ou implementar rebind de
identidade/sessão no fluxo atual, com regras explícitas de segurança e UX.

#### A-05 — Históricos e stores ativos sem limite ou retenção

`SessionRequestManager.historyById`, `SessionManager.history`, `RequestStore` e `SessionStore`
crescem sem limite. Heartbeats nominais também geram log a cada 30 segundos por cliente.

**Impacto:** crescimento monotônico de RAM e de volume de logs em operação prolongada.

**Decisão:** documentado. Aplicar um limite arbitrário agora apagaria o “histórico completo” exposto
pela API. A correção correta faz parte da persistência: retenção no banco, paginação e métricas de
capacidade.

#### A-06 — Backend exposto sem controle de abuso

Não há limite por IP/identidade para conexões, registros, solicitações ou eventos. O Socket.IO usa o
limite padrão de payload, mas isso não impede abertura massiva de sockets e amplificação de logs.

**Impacto:** exaustão de memória/CPU e indisponibilidade, agravada pela ausência de autenticação.

**Decisão:** não corrigido isoladamente. Rate limit confiável depende de identidade, proxy
conhecido, política de rede e observabilidade. Deve acompanhar C-01 antes da exposição pública.

#### A-07 — Distribuição Electron não assinada

A auditoria BETA-6C confirmou instalador com Authenticode `NotSigned`. Não há configuração de
assinatura, publicação segura ou atualização autenticada.

**Impacto:** alerta do Windows/SmartScreen, risco de substituição do instalador e ausência de cadeia
de confiança operacional.

**Decisão:** não corrigido; exige certificado de assinatura e processo de release protegido.

### Médios

#### M-01 — Duas pilhas de domínio e comunicação ativas

Duplicação de presença, request, session, signaling e heartbeat aumenta acoplamento, timers,
listeners e risco de corrigir uma pilha sem corrigir a usada pelo produto.

#### M-02 — Frontend e transferência de arquivos excessivamente monolíticos

Arquivos de 900–1.600 linhas dificultam testes unitários, revisão e evolução. Os dois clientes de
transferência são duplicados, criando risco de divergência.

#### M-03 — Teste do engine mascara teardown nativo

O script usa `--test-force-exit`. Sem essa flag, os testes funcionais passam, mas os arquivos
`webrtc.spec.ts` e `rtc-engine.spec.ts` falham no teardown do `@roamhq/wrtc`; em uma execução
isolada houve erro nativo de `HandleScope`. O pacote é dependência de teste, não do Electron de
produção, mas a flag impede detectar handles nativos restantes.

#### M-04 — Cobertura de cenários operacionais incompleta

Há 107 testes e boas simulações de reconexão de domínio, dispositivos, 4K, múltiplos monitores,
arquivos de mais de 1 GB e cleanup. Não há teste automatizado do fluxo Electron ativo para:

- perda e retorno real do Socket.IO durante atendimento;
- suspensão/retorno do Windows;
- soak de 4 h e 24 h;
- perda de pacotes, alta latência e rede flapping com proxy de rede;
- mudança de TURN/STUN em runtime;
- pressão concorrente com muitas sessões.

#### M-05 — Observabilidade insuficiente

Logs estruturados existem, mas vão apenas para stdout/stderr. Não há métricas de conexões, sessões,
event loop lag, heap, GC, quedas WebRTC, bitrate, FPS, erros ICE ou fila de transferência. O health
check confirma somente que o processo HTTP responde.

#### M-06 — Workspaces reservados aumentam custo sem entregar runtime

`shared`, `ui`, `database` e os dois apps Tauri são compilados em toda validação, mas estão vazios ou
fora do produto atual. Tauri/Prisma ampliam instalação e manutenção sem consumo de produção.

#### M-07 — Entradas nominais não possuem limite de comprimento explícito

Nomes de aluno/professor e o ID nominal do aluno são apenas normalizados com `trim()`. O transporte
limita o pacote, mas strings grandes ainda podem alcançar memória, logs e respostas HTTP.

#### M-08 — Build Docker não validado nesta estação

O Dockerfile adota usuário não-root, Compose read-only, `no-new-privileges`, `init` e healthcheck,
mas a ausência do executável Docker impediu validar a imagem final e o healthcheck real.

### Baixos

#### B-01 — `npm run check` falha apenas no Prettier de evidências históricas

Os arquivos `beta-6c-baseline.json`, `beta-6c-window-lifecycle.json` e
`session-accept-smoke.json` não obedecem ao formato atual. Código, lint, tipos e testes passam.

#### B-02 — Documentação arquitetural está defasada

O documento do monorepo descreve responsabilidades ideais, mas não destaca que o banco está vazio,
que cinco workspaces são reservados e que duas pilhas Socket.IO coexistem.

## 5. Pontos aprovados

### Electron e IPC

- `contextIsolation: true`;
- `nodeIntegration: false`;
- `sandbox: true`;
- CSP sem `unsafe-inline`/`unsafe-eval`;
- novas janelas e navegações bloqueadas;
- permissões restritas ao WebContents principal e a mídia;
- Preload expõe operações específicas, não `ipcRenderer` genérico;
- handlers IPC validam o `sender.id` e normalizam payloads;
- limpeza de IPC, listeners, sockets e recursos no fechamento.

### WebRTC, mídia e controle remoto

- ICE Candidates pendentes possuem limite;
- renegociações são serializadas;
- professor executa ICE restart em falha/desconexão de mídia;
- tracks e PeerConnections são encerrados no cleanup;
- troca/remoção de câmera e microfone possui tratamento;
- controle remoto exige sessão, papel correto, referência e aprovação;
- `mousemove` usa transporte volátil e logging amostrado;
- mouse e teclado nativos liberam estado pressionado ao encerrar;
- múltiplos monitores, coordenadas 4K e minimização possuem regressões.

### Transferência de arquivos

- chunks de 64 KiB e janela máxima de 16;
- backpressure pelo `bufferedAmount`;
- SHA-256 por chunk e arquivo;
- escrita incremental, sem carregar arquivo completo;
- retomada persistida e tratamento de duplicidade;
- nomes sanitizados e caminhos locais não são expostos ao peer;
- checagem de espaço e tradução de erros de disco;
- testes para 100 MB, 500 MB, 1 GB e mais de 1 GB.

### Build e dependências

- TypeScript estrito e ESLint sem warnings;
- Turbo com dependências de build coerentes;
- lockfile presente;
- nenhuma vulnerabilidade de produção reportada pelo npm;
- imagem prevista como usuário não-root e filesystem read-only.

## 6. Correções autorizadas para esta Sprint

1. Encerrar automaticamente sessões ativas associadas a um socket desconectado.
2. Preservar os sockets participantes dentro do manager enquanto a sessão estiver ativa, evitando
   depender de um registro de presença que já foi removido.
3. Notificar o participante remanescente e listeners de encerramento, incluindo a revogação de
   controle remoto.
4. Adicionar testes unitário e integrado para impedir regressão.

Não serão adicionados login improvisado, banco parcial, credenciais TURN estáticas, rate limit sem
política ou refatorações cosméticas.

## 7. Recomendação de go/no-go

**NO-GO para produção pública.**

Uma homologação controlada em rede restrita pode continuar para validar mídia e UX, desde que:

- o backend não esteja publicamente acessível;
- dados usados sejam fictícios;
- não haja expectativa de histórico durável;
- a rede de teste permita conexão direta WebRTC;
- quedas de rede sejam tratadas como encerramento do atendimento.

O go-live exige, no mínimo, fechar C-01, A-01, A-02, A-04, A-06 e A-07.

## 8. Correções realizadas

### 8.1 Encerramento determinístico em desconexão

`SessionManager` passou a guardar os sockets do professor e do aluno no momento em que a sessão é
criada. O registro vive somente enquanto a sessão está ativa.

Foi adicionado `endSessionsForParticipant(socketId)`, que:

1. localiza todas as sessões ativas ligadas ao socket;
2. usa o mesmo caminho de finalização do encerramento explícito;
3. move a sessão para o histórico como `finished`;
4. conserva os dois sockets na entrega de encerramento;
5. notifica listeners, inclusive o gateway de controle remoto;
6. remove o registro interno de participantes.

`SessionGateway` agora trata `disconnect`, finaliza as sessões encontradas e envia `session:ended`
ao participante remanescente.

### 8.2 Preservação do motivo de parada do controle remoto

O listener de desconexão do `RemoteControlGateway` é registrado antes do listener de sessão. Assim,
uma queda continua gerando `reason: disconnect`, como no comportamento anterior, e depois a sessão é
finalizada. Isso evita regressão em logs, estado e testes do controle remoto.

### 8.3 Proteção contra aceite depois que o aluno ficou offline

`SessionRequestManager` agora recusa o aceite se o aluno original já não estiver online. A
solicitação permanece pendente e pode expirar pelo fluxo existente, em vez de ser marcada como
aceita sem que uma sessão válida possa ser criada.

`SessionManager.createSession` também exige defensivamente os dois sockets antes de inserir qualquer
estado ativo. Essa segunda barreira impede sessões parciais caso outro chamador use o manager no
futuro.

## 9. Justificativa técnica e impacto

| Alteração                                  | Justificativa                                                     | Impacto esperado                                     |
| ------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- |
| sockets preservados no manager             | presença pode ser removida antes do listener de sessão            | entrega confiável ao participante restante           |
| finalização única em `finishSession`       | evita divergência entre encerramento explícito e desconexão       | histórico e listeners sempre consistentes            |
| cleanup no `disconnect`                    | o cliente já descartava a sessão, mas o servidor não              | elimina sessões ativas órfãs e crescimento associado |
| controle remoto registrado antes da sessão | mantém o motivo de parada já contratado                           | nenhuma mudança perceptível no fluxo existente       |
| aceite bloqueado para aluno offline        | fecha a corrida entre solicitação pendente e perda de conexão     | não cria sessão sem os dois participantes            |
| precondição defensiva em `createSession`   | protege integridade mesmo fora do gateway atual                   | falha atômica, sem inserir estado parcial            |
| testes unitário e integrado                | reproduzem remoção prévia de presença e desconexão Socket.IO real | previnem regressão em cleanup e notificação          |

Não houve alteração de tela, texto, protocolo público, WebRTC, mídia, compartilhamento, arquivo,
mouse, teclado, preload ou IPC.

## 10. Arquivos modificados

- `services/backend/websocket/src/modules/active-session/session.manager.ts`
- `services/backend/websocket/src/modules/active-session/session.gateway.ts`
- `services/backend/websocket/src/modules/session-request/session-request.manager.ts`
- `services/backend/websocket/src/socket-server.ts`
- `services/backend/websocket/tests/active-session.spec.ts`
- `services/backend/websocket/tests/session-request.spec.ts`
- `services/backend/websocket/tests/session-request-flow.spec.ts`
- `auditorias/SPRINT-BETA-9A-AUDITORIA-GERAL.md`

## 11. Testes adicionados

- manager encerra a sessão mesmo depois que a presença do aluno foi removida;
- entrega de encerramento preserva sockets de professor e aluno;
- socket desconhecido não encerra outras sessões;
- solicitação não pode ser aceita depois que o aluno fica offline;
- desconexão Socket.IO real encerra a sessão e notifica o professor.

Após as alterações, a suíte isolada do websocket passou com 20/20 testes.

## 12. Riscos remanescentes e próximas Sprints

### Sprint de identidade e segurança

- autenticação de usuário/dispositivo;
- autorização por papel e por recurso;
- credenciais curtas, rotação e revogação;
- proteção das rotas HTTP;
- rate limit no proxy e na aplicação;
- testes de personificação e abuso.

### Sprint de persistência e operação

- modelo Prisma para atendimentos, solicitações e auditoria;
- migrações versionadas;
- transações e idempotência;
- retenção, paginação, backup e restauração;
- Redis adapter ou arquitetura equivalente antes de múltiplas réplicas;
- métricas, tracing, alertas e dashboards.

### Sprint de conectividade

- TURN em produção com credenciais efêmeras;
- entrega segura de `iceServers` ao cliente;
- consolidação das duas pilhas Socket.IO;
- rebind de identidade/sessão durante a janela de reconexão;
- testes com Toxiproxy/Clumsy para perda, jitter e flapping.

### Sprint de endurance e release

- soak tests de 4 h e 24 h;
- suspensão/retorno e troca de USB/DPI em hardware real;
- heap snapshots e event loop lag;
- build Docker em CI;
- assinatura Authenticode e proteção dos artefatos;
- remoção de `--test-force-exit` após estabilizar o teardown do `@roamhq/wrtc`.

## 13. Validação final

Executada depois das correções:

| Validação                                | Resultado                                               |
| ---------------------------------------- | ------------------------------------------------------- |
| `npm run build`                          | aprovado, 13/13 workspaces                              |
| `npx turbo run build --force`            | aprovado, 13/13 workspaces, sem cache                   |
| `npx turbo run test --force --summarize` | aprovado, 116/116 testes funcionais, sem cache          |
| `npm run lint`                           | aprovado, 13/13 workspaces                              |
| `npm run typecheck`                      | aprovado, 13/13 workspaces                              |
| Prettier nos oito arquivos desta entrega | aprovado                                                |
| `git diff --check`                       | aprovado                                                |
| `npm audit --omit=dev`                   | 0 vulnerabilidades conhecidas                           |
| busca de ciclos em imports de produção   | nenhum ciclo encontrado                                 |
| build da imagem Docker                   | não executado; Docker indisponível na estação           |
| `npm run format:check` global            | falhou somente nas três evidências JSON históricas B-01 |

O total funcional passou de 114 para 116 testes com as duas novas regressões. O teste integrado
existente também foi ampliado com uma segunda sessão e desconexão Socket.IO real.

Os arquivos históricos que mantêm o `format:check` global vermelho não foram alterados porque são
evidências de auditorias anteriores, o problema é baixo e a Sprint autorizou mudanças apenas para
achados críticos/altos.

## 14. Resultado final da Sprint

A correção elimina a inconsistência imediata de sessões órfãs e a corrida de aceite após queda do
aluno, sem alterar experiência ou fluxo normal.

O resultado de prontidão continua **NO-GO para produção pública** pelos bloqueios de autenticação,
persistência, TURN, reconexão de sessão, controle de abuso e assinatura de release. O relatório não
declara uma falsa prontidão: esses itens precisam de requisitos e infraestrutura próprios antes do
go-live.
