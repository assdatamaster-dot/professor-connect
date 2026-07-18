# Contexto de IA — Professor Connect

## Objetivo do projeto

O Professor Connect será uma plataforma de atendimento remoto entre alunos e professores. O
produto deverá permitir que cada perfil utilize um aplicativo desktop próprio e se comunique
com serviços centrais por interfaces bem definidas.

Este documento oferece contexto persistente para pessoas e agentes de IA. Na Sprint 1, o único
resultado autorizado é a fundação do projeto. Não existem funcionalidades, telas, login, banco
de dados, chamadas de vídeo ou acesso remoto implementados.

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

Todos os workspaces possuem apenas manifests, configuração TypeScript e barrels vazios para
permitir validação estrutural. A presença de uma dependência indica a tecnologia escolhida e o
módulo que será seu proprietário; não indica que a integração esteja implementada.
