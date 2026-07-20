# Contexto de IA — Professor Connect

## Objetivo do projeto

O Professor Connect será uma plataforma de atendimento remoto entre alunos e professores. O
produto deverá permitir que cada perfil utilize um aplicativo desktop próprio e se comunique
com serviços centrais por interfaces bem definidas.

Este documento oferece contexto persistente para pessoas e agentes de IA. A Sprint 9 adiciona
heartbeat periódico, detecção de timeout e recuperação de conexão em memória. O `clientId` é a
identidade estável e o `connectionId` identifica somente o socket atual. Uma recuperação válida
preserva Presence, Sessions e referências a Requests e Calls ativas. O protocolo continua
baseado em `SocketMessage<T>` e `EventType`. Não existem login, banco de dados, WebRTC, mídia ou
acesso remoto implementados.

## Arquitetura completa

O sistema é um monorepo organizado em três grupos de workspaces:

1. `apps/`: clientes desktop e composição da experiência de cada perfil.
2. `backend/`: portas de entrada, casos de uso, infraestrutura e configuração do servidor.
3. `packages/`: contratos e recursos reutilizáveis sem vínculo com uma aplicação específica.

A arquitetura seguirá os limites da Clean Architecture:

- **Apresentação:** aplicativos Tauri. Converte interações em chamadas a casos de uso remotos e
  apresenta resultados. Não contém regra de negócio do servidor.
- **Interfaces de entrada:** API e WebSocket. Validam e transformam protocolos externos antes de
  acionar serviços.
- **Aplicação:** serviços e casos de uso. Orquestram regras e dependem de contratos, não de
  frameworks de transporte ou persistência.
- **Infraestrutura:** banco de dados e configuração. Implementam contratos técnicos e isolam
  Prisma, PostgreSQL e variáveis de ambiente.
- **Compartilhamento:** tipos, utilitários e base visual. Só recebe itens com uso real em mais de
  um consumidor.

### Regra de dependência

Dependências devem apontar para módulos mais estáveis. Um serviço pode declarar uma porta de
persistência; o adaptador Prisma implementa essa porta. O serviço não deve importar detalhes do
Prisma. API e WebSocket podem chamar serviços, mas serviços não podem importar API ou Socket.IO.
Aplicativos não acessam o banco diretamente.

## Tecnologias utilizadas

- Monorepo com workspaces do npm.
- Turborepo para pipeline, cache e execução coordenada.
- TypeScript estrito para todos os módulos de código.
- Node.js como runtime dos serviços e ferramentas.
- Tauri para os futuros clientes desktop.
- Socket.IO para a futura comunicação orientada a eventos.
- PostgreSQL como futuro banco relacional.
- Prisma como futuro ORM e ferramenta de migração.
- ESLint, Prettier e EditorConfig para consistência e qualidade.

## Padrões de nomenclatura

- Diretórios e arquivos: `kebab-case` (`session-service.ts`).
- Classes, tipos, interfaces e enums: `PascalCase` (`SessionService`).
- Funções, métodos, propriedades e variáveis: `camelCase` (`createSession`).
- Constantes globais: `UPPER_SNAKE_CASE` (`DEFAULT_TIMEOUT_MS`).
- Booleanos: prefixos semânticos como `is`, `has`, `can` ou `should`.
- Casos de uso: verbo mais objeto (`create-support-session.ts`).
- Serviços: sufixo `-service.ts`; repositórios: `-repository.ts`.
- Testes: mesmo nome do alvo com `.spec.ts`.
- Eventos: ação concluída no passado e domínio explícito (`session:created`).
- Pacotes: escopo `@professor-connect/` seguido de nome em `kebab-case`.

Evite nomes genéricos como `manager`, `helper`, `common`, `data` e `misc` quando não revelarem a
responsabilidade real.

## Regras de desenvolvimento

1. Respeitar o escopo da sprint e não antecipar funcionalidades.
2. Manter TypeScript em modo estrito; não usar `any`.
3. Validar dados nas fronteiras do sistema e trabalhar internamente com tipos conhecidos.
4. Não importar código interno de outro workspace; consumir apenas sua API pública.
5. Não criar dependências circulares nem acoplamento entre transporte e domínio.
6. Não acessar variáveis de ambiente fora de `backend/config`.
7. Não registrar segredos, credenciais ou dados pessoais em código ou logs.
8. Adicionar uma abstração somente quando houver uma variação ou fronteira real.
9. Manter alterações pequenas, coesas, testáveis e documentadas.
10. Executar `npm run check` antes de considerar uma tarefa pronta.

## Princípios SOLID

- **Single Responsibility:** cada módulo e unidade de código possui um único motivo para mudar.
- **Open/Closed:** comportamentos são estendidos por contratos e composição, sem condicionais
  espalhadas.
- **Liskov Substitution:** implementações preservam as garantias definidas por seus contratos.
- **Interface Segregation:** consumidores dependem de interfaces pequenas e específicas.
- **Dependency Inversion:** regras centrais dependem de abstrações; frameworks ficam nas bordas.

## Clean Code

- Nomes devem revelar intenção e refletir a linguagem do domínio.
- Funções devem ser curtas, operar em um nível de abstração e evitar efeitos ocultos.
- Comentários explicam decisões e restrições, não repetem o código.
- Erros devem carregar contexto útil sem expor informações sensíveis.
- Duplicação deve ser removida quando representar o mesmo conhecimento, não apenas texto similar.
- Limites, estados inválidos e falhas externas precisam de tratamento explícito.
- Código morto, flags temporárias vencidas e abstrações especulativas devem ser removidos.

## Responsabilidade de cada módulo

| Módulo                  | Responsabilidade                              | Não deve conter                              |
| ----------------------- | --------------------------------------------- | -------------------------------------------- |
| `apps/student-desktop`  | Composição futura da experiência do aluno     | Regras do servidor ou acesso direto ao banco |
| `apps/teacher-desktop`  | Composição futura da experiência do professor | Regras do servidor ou acesso direto ao banco |
| `backend/api`           | Adaptadores futuros de requisição e resposta  | Regras de negócio ou consultas Prisma        |
| `backend/websocket`     | Adaptadores futuros de eventos Socket.IO      | Regras de negócio ou persistência            |
| `backend/services`      | Casos de uso e orquestração futura            | Dependência de HTTP, Socket.IO ou Prisma     |
| `backend/database`      | Adaptadores Prisma e persistência futura      | Casos de uso ou regras de apresentação       |
| `backend/config`        | Leitura e validação futura de configuração    | Regras de negócio                            |
| `packages/shared-types` | Contratos usados por múltiplos workspaces     | Implementações, estado ou efeitos colaterais |
| `packages/shared-utils` | Funções puras e agnósticas reutilizadas       | Código específico de uma aplicação           |
| `packages/ui`           | Base visual compartilhada futura              | Fluxos de negócio ou comunicação com backend |
| `docs`                  | Documentação técnica e de produto             | Código executável                            |
| `prompts`               | Prompts versionados e seus metadados          | Segredos ou dados pessoais                   |
| `auditorias`            | Evidências e relatórios técnicos              | Artefatos gerados sensíveis                  |
| `ai-context`            | Contextos auxiliares e delimitados para IA    | Credenciais ou instruções conflitantes       |
| `deploy`                | Infraestrutura e entrega futuras              | Lógica de aplicação                          |
| `scripts`               | Automação repetível futura                    | Regras de negócio                            |

## Fluxo geral do sistema

O fluxo abaixo descreve a direção planejada, não uma implementação atual:

1. A pessoa interage com o aplicativo desktop correspondente ao seu perfil.
2. O aplicativo envia uma requisição para a API ou um evento para a camada WebSocket.
3. A fronteira valida o formato recebido e chama um serviço de aplicação.
4. O serviço executa o caso de uso e, quando necessário, chama uma porta de persistência.
5. Um adaptador de banco implementa a porta por meio do Prisma e PostgreSQL.
6. O resultado retorna pela mesma fronteira; eventos relevantes podem ser publicados aos clientes.
7. Contratos compartilhados mantêm consistência entre produtores e consumidores sem compartilhar
   regras de negócio indevidamente.

## Estado da fundação

Os workspaces permanecem separados pelas fronteiras definidas na Sprint 1. `api` executa o
servidor HTTP e expõe exclusivamente `GET /health`; `websocket` adapta o protocolo tipado ao
Socket.IO; `services` contém managers independentes e Services de conexão e sessão;
`shared-types` publica `EventType`, `SocketMessage<T>` e contratos de sessão, presença e
solicitação; `services` contém os módulos `presence` e `request`, independentes de Socket.IO;
`config` centraliza o ambiente, o timeout de Request e as configurações de heartbeat; e
`database` mantém somente a configuração inicial do Prisma. Sessões, conexões, presenças,
solicitações, Calls e metadados de heartbeat existem apenas em memória durante a vida do
processo. `STUDENT` e `TEACHER` são classificações técnicas, sem autenticação.

O módulo `request` separa `RequestStore`, `RequestManager` e `RequestService`. O store mantém
registros, destinatários e rejeições; o manager delega mudanças de status para
`RequestStateMachine`; o service valida papéis por meio de `PresenceService`, agenda expirações e
publica resultados sem conhecer Socket.IO. Rejeições são individuais: a Request compartilhada
permanece `PENDING`, inclusive após todos os destinatários rejeitarem, até aceite, cancelamento ou
expiração. Estados terminais são removidos da visão de Requests ativas, mas ficam em memória para
consulta técnica durante a vida do processo.

A infraestrutura genérica reside em `backend/services/src/core/state-machine`, porque
`backend/services` é o workspace proprietário das regras de aplicação; não existe um workspace
válido em `backend/src`. `StateMachine<TState>` recebe o grafo de transições e dependências
injetáveis de relógio e logger. Ela não importa tipos de Request nem frameworks. Cada mudança
válida cria `StateTransition<TState>` com estado anterior, novo estado e timestamp, registra o
histórico e emite um evento. Transições inválidas preservam o estado e lançam
`InvalidStateTransitionError` com código `INVALID_STATE_TRANSITION`.

O grafo de Request permite somente `PENDING → ACCEPTED|REJECTED|CANCELLED|EXPIRED`. Estados
terminais não possuem transições de saída. Aceite, cancelamento e expiração operacionais passam
obrigatoriamente pela máquina. As rejeições individuais do protocolo continuam sendo metadados
de destinatário da Sprint 6; uma futura mudança compartilhada para `REJECTED` já está protegida
pelo mesmo grafo, sem antecipar nova regra de produto.

O módulo `backend/services/src/modules/call` separa `CallStore`, `CallStateMachine`, `CallManager`
e `CallService`. O store implementa as operações em memória com `Map`; a máquina declara somente
as sete transições permitidas; o manager gera UUID, mantém uma máquina e um histórico por Call e
atualiza timestamps a partir dos objetos de transição; o service valida que a Request esteja
`ACCEPTED`, publica eventos de ciclo de vida e registra logs sem conhecer Socket.IO.

O gateway assina os eventos do `CallService`. Depois de `request.accept`, ele cria a Call em
`CREATED` e solicita `CONNECTING`; `call.created` e `call.connecting` são enviados apenas ao aluno
e ao professor aceito. Os estados `CONNECTED`, `FINISHED`, `FAILED` e `CANCELLED` estão disponíveis
no service para simulação e futura integração, mas nenhum protocolo de mídia foi implementado.

O grafo de Call permite somente `CREATED → CONNECTING|FAILED|CANCELLED`,
`CONNECTING → CONNECTED|FAILED|CANCELLED` e `CONNECTED → FINISHED`. Todas as demais combinações
lançam `InvalidStateTransitionError`, preservam estado e histórico e não emitem evento válido.

O módulo `backend/services/src/modules/heartbeat` separa `HeartbeatManager` e
`HeartbeatService`. O manager mantém índices por `clientId` e `connectionId`, além de `lastSeen`,
`ConnectionStatus` e `ConnectionState`. O service agenda inspeções, coordena portas de Connection,
Presence e recursos recuperáveis e publica eventos internos sem importar Socket.IO. A composição
concreta permanece em `backend/websocket`.

Após uma perda, Presence preserva o status anterior e deixa de indexar o socket antigo. Uma
reconexão anterior ao menor limite entre timeout de heartbeat e janela de reconexão substitui o
socket nas Sessions, mantém o mesmo `clientId` e retorna Presence, Sessions, Requests pendentes e
Calls ativas em `connection.recovered`. O gateway reinscreve o socket nas salas restauradas.
Após o limite, a conexão é removida, Presence muda para `OFFLINE` e associações técnicas de
Session são liberadas. Requests e Calls não sofrem transição automática, pois continuam sob seus
próprios ciclos de vida.

As configurações pertencem exclusivamente a `backend/config`: `HEARTBEAT_INTERVAL_MS=30000`,
`HEARTBEAT_TIMEOUT_MS=90000` e `RECONNECT_WINDOW_MS=90000`. O intervalo deve ser menor que o
timeout, e a janela não pode exceder o timeout. Os eventos `heartbeat.ping`, `heartbeat.pong`,
`connection.lost`, `connection.recovered` e `connection.timeout` usam os contratos compartilhados
de `EventType` e `SocketMessage<T>`.
