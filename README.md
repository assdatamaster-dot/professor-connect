# Professor Connect

O Professor Connect é uma plataforma planejada para aproximar alunos e professores em
atendimentos remotos. Este repositório contém a fundação técnica do produto: organização do
monorepo, limites entre módulos, ferramentas de qualidade e documentação para orientar a
evolução do sistema.

> **Estado atual:** Sprint 1 — fundação. Não há telas, autenticação, persistência, chamadas de
> vídeo, comunicação em tempo real ou acesso remoto implementados.

## Arquitetura

O projeto adota monorepo com separação explícita entre clientes desktop, módulos de backend e
pacotes compartilhados. A arquitetura pretendida segue Clean Architecture:

```text
Aplicativos desktop
        │
        ├── API (requisição/resposta)
        └── WebSocket (eventos em tempo real)
                         │
                   Serviços de aplicação
                         │
                  Camada de persistência
                         │
                      PostgreSQL
```

As dependências devem apontar das camadas externas para contratos internos. Regras de negócio
não devem depender de Tauri, Socket.IO, Prisma ou detalhes de infraestrutura. Tipos, utilitários
e elementos visuais realmente reutilizáveis ficam em `packages/`.

## Tecnologias

- **Turborepo:** orquestração de tarefas, cache e dependências entre workspaces.
- **TypeScript e Node.js:** linguagem e ambiente de execução dos módulos.
- **Tauri:** base prevista para os aplicativos desktop de aluno e professor.
- **Socket.IO:** transporte previsto para eventos em tempo real.
- **PostgreSQL e Prisma:** persistência relacional prevista e acesso tipado aos dados.
- **ESLint, Prettier e EditorConfig:** análise estática e padronização do código.

Nesta sprint, Tauri, Socket.IO e Prisma estão apenas declarados nos workspaces responsáveis.
Não existem configuração de produto, schema de dados ou integrações ativas.

## Estrutura de pastas

```text
ProfessorConnect/
├── apps/
│   ├── student-desktop/   # Cliente desktop do aluno
│   └── teacher-desktop/   # Cliente desktop do professor
├── backend/
│   ├── api/               # Entrada HTTP futura
│   ├── websocket/         # Entrada de eventos futura
│   ├── services/          # Casos de uso e orquestração futuros
│   ├── database/          # Adaptadores de persistência futuros
│   └── config/            # Configuração validada futura
├── packages/
│   ├── shared-types/      # Contratos compartilhados
│   ├── shared-utils/      # Utilitários agnósticos
│   └── ui/                # Base visual compartilhada futura
├── docs/                  # Guias e planejamento
├── prompts/               # Prompts versionados
├── auditorias/            # Registros de auditoria técnica
├── ai-context/            # Contextos auxiliares para agentes de IA
├── deploy/                # Artefatos de entrega futuros
└── scripts/               # Automação operacional futura
```

## Pré-requisitos

- Node.js 22.12 ou superior
- npm 10 ou superior
- Git

Rust e as dependências nativas do Tauri serão necessários quando os aplicativos forem
inicializados em uma sprint futura, mas não são necessários para validar esta fundação.

## Instalação

Na raiz do repositório:

```bash
npm install
```

O npm reconhece automaticamente os diretórios de `apps/`, `backend/` e `packages/` como
workspaces.

## Desenvolvimento

Use os comandos abaixo durante o desenvolvimento:

```bash
npm run lint          # executa o ESLint em todos os workspaces
npm run typecheck     # valida os tipos sem gerar arquivos
npm run format:check  # confere a formatação
npm run check         # executa todas as verificações de qualidade
npm run build         # compila os workspaces com cache do Turborepo
npm run format        # aplica a formatação padronizada
npm run clean         # remove saídas de compilação dos workspaces
```

Não há comando para iniciar a aplicação nesta sprint, pois nenhum processo ou interface foi
implementado. Consulte o [Guia do Desenvolvedor](docs/DEVELOPER_GUIDE.md), o
[Contexto de IA](AI_CONTEXT.md) e o [Roadmap](docs/ROADMAP.md) antes de iniciar uma nova tarefa.

## Princípios de evolução

- Uma responsabilidade clara por módulo.
- Dependências explícitas e dirigidas para abstrações.
- Contratos pequenos e estáveis entre workspaces.
- Código simples, testável e sem duplicação acidental.
- Mudanças incrementais, verificáveis e documentadas.
