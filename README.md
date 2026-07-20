# Professor Connect

O Professor Connect é uma plataforma planejada para aproximar alunos e professores em
atendimentos remotos. Este repositório contém a fundação técnica do produto: organização do
monorepo, limites entre módulos, ferramentas de qualidade e documentação para orientar a
evolução do sistema.

> **Estado atual:** Sprint 2 — infraestrutura inicial do backend. O servidor Express, o health
> check e o Socket.IO estão ativos. Não há autenticação, persistência, regras de negócio,
> chamadas de vídeo ou acesso remoto implementados.

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
- **Express:** servidor HTTP e fronteira da API.
- **Socket.IO:** servidor preparado para receber conexões em tempo real.
- **Prisma:** cliente configurado para a futura persistência PostgreSQL, ainda sem modelos.
- **ESLint, Prettier e EditorConfig:** análise estática e padronização do código.

Nesta sprint, o backend expõe somente `GET /health`. O Prisma possui apenas a configuração
inicial, sem modelos, migrações ou acesso ao banco. Os aplicativos Tauri continuam reservados
para sprints futuras.

## Estrutura de pastas

```text
ProfessorConnect/
├── apps/
│   ├── student-desktop/   # Cliente desktop do aluno
│   └── teacher-desktop/   # Cliente desktop do professor
├── backend/
│   ├── api/               # Servidor Express, health check e tratamento de erros
│   ├── websocket/         # Inicialização do Socket.IO
│   ├── services/          # Casos de uso e orquestração futuros
│   ├── database/          # Configuração inicial do Prisma, sem modelos
│   └── config/            # Variáveis de ambiente validadas
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
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env` no lugar de `cp`. Os valores padrão permitem
iniciar o servidor sem alterar o arquivo. A variável `DATABASE_URL` fica reservada para o Prisma;
o backend não tenta acessar um banco nesta sprint.

Para gerar novamente o cliente Prisma após alterações futuras no schema:

```bash
npm run prisma:generate
```

## Desenvolvimento

Inicie o backend com recarregamento automático:

```bash
npm run dev
```

O servidor fica disponível em `http://localhost:3000`. Verifique o health check com:

```bash
curl http://localhost:3000/health
```

Resposta esperada:

```json
{
  "status": "ok"
}
```

O processo também registra que o Socket.IO foi inicializado e está aguardando conexões.

## Build e execução

Para compilar e executar o backend compilado:

```bash
npm run build
npm run start
```

Outros comandos disponíveis:

```bash
npm run lint          # executa o ESLint em todos os workspaces
npm run typecheck     # valida os tipos sem gerar arquivos
npm run test          # executa os testes automatizados
npm run format:check  # confere a formatação
npm run check         # executa todas as verificações de qualidade
npm run format        # aplica a formatação padronizada
npm run clean         # remove saídas de compilação dos workspaces
```

## Docker para desenvolvimento

O `docker-compose.yml` é exclusivo para desenvolvimento e inicia somente o backend, com o código
local montado no contêiner:

```bash
docker compose up --build
```

Nenhum serviço de banco de dados é criado nesta sprint.

Consulte o [Guia do Desenvolvedor](docs/DEVELOPER_GUIDE.md), o
[Contexto de IA](AI_CONTEXT.md) e o [Roadmap](docs/ROADMAP.md) antes de iniciar uma nova tarefa.

## Princípios de evolução

- Uma responsabilidade clara por módulo.
- Dependências explícitas e dirigidas para abstrações.
- Contratos pequenos e estáveis entre workspaces.
- Código simples, testável e sem duplicação acidental.
- Mudanças incrementais, verificáveis e documentadas.
