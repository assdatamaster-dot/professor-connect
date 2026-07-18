# Guia do Desenvolvedor

## Padrões do projeto

O Professor Connect usa workspaces do npm e Turborepo. Cada aplicação, módulo de backend ou
pacote compartilhado deve ser independente, ter uma API pública pequena e declarar suas próprias
dependências. O `tsconfig.base.json`, o ESLint, o Prettier e o EditorConfig definem a base comum.

Antes de alterar código, identifique a camada proprietária da responsabilidade. Prefira alta
coesão dentro do módulo e comunicação por contratos explícitos entre módulos.

## Como criar módulos

1. Confirme que a responsabilidade não pertence a um workspace existente.
2. Crie o diretório no grupo adequado: `apps/`, `backend/` ou `packages/`.
3. Adicione um `package.json` privado com nome `@professor-connect/<nome>`.
4. Estenda o `tsconfig.base.json` e limite `rootDir` a `src`.
5. Exponha somente a API pública necessária por `src/index.ts` e pelo campo `exports`.
6. Declare dependências no workspace consumidor; não dependa de caminhos relativos externos.
7. Inclua scripts `build`, `lint`, `typecheck` e `clean` compatíveis com o pipeline.
8. Documente a responsabilidade, os limites e as decisões relevantes.

Não crie um módulo apenas para reduzir o tamanho de uma pasta. Um novo módulo precisa representar
uma fronteira de responsabilidade, implantação, propriedade ou reutilização real.

## Como criar serviços

- Coloque serviços de aplicação em `backend/services/src`.
- Dê ao serviço o nome do caso de uso ou capacidade que ele representa.
- Receba dependências pelo construtor ou função fábrica, usando contratos pequenos.
- Mantenha regras independentes de HTTP, Socket.IO, Tauri, Prisma e variáveis de ambiente.
- Retorne resultados de domínio ou erros tipados; não retorne objetos de framework.
- Isole efeitos externos atrás de portas e teste o caso de uso com implementações controladas.

Uma função simples é preferível a uma classe quando não há estado, ciclo de vida ou múltiplas
operações coesas que justifiquem a classe.

## Como nomear arquivos

| Elemento                | Padrão                     | Exemplo                        |
| ----------------------- | -------------------------- | ------------------------------ |
| Arquivo ou diretório    | `kebab-case`               | `support-session/`             |
| Serviço                 | `<capacidade>-service.ts`  | `session-service.ts`           |
| Caso de uso             | `<verbo>-<objeto>.ts`      | `create-session.ts`            |
| Contrato de repositório | `<entidade>-repository.ts` | `session-repository.ts`        |
| Adaptador               | `<tecnologia>-<papel>.ts`  | `prisma-session-repository.ts` |
| Controlador             | `<recurso>-controller.ts`  | `session-controller.ts`        |
| Validação               | `<recurso>-schema.ts`      | `session-schema.ts`            |
| Teste unitário          | `<alvo>.spec.ts`           | `create-session.spec.ts`       |

Use `PascalCase` para tipos e classes, `camelCase` para valores e `UPPER_SNAKE_CASE` para
constantes globais. Evite abreviações não padronizadas.

## Como organizar pastas

Organize primeiro por domínio ou capacidade e depois por papel técnico dentro do módulo. Mantenha
arquivos que mudam juntos próximos entre si. Evite pastas genéricas como `helpers` ou `misc`.

Uma capacidade futura pode seguir esta forma, sem obrigar todos os níveis quando forem
desnecessários:

```text
src/
└── support-session/
    ├── application/
    ├── domain/
    ├── infrastructure/
    └── index.ts
```

Somente o `index.ts` público do workspace deve ser usado por consumidores externos. Imports
internos podem apontar diretamente para arquivos da mesma capacidade.

## Boas práticas

- Entregue a solução mais simples que satisfaça o caso de uso atual.
- Mantenha funções pequenas, nomes expressivos e efeitos colaterais visíveis.
- Valide entrada em fronteiras e preserve invariantes no domínio.
- Não use `any`, imports circulares, estado global mutável ou captura silenciosa de erro.
- Nunca versione segredos. Use exemplos sem credenciais para documentar variáveis futuras.
- Adicione testes no nível mais baixo capaz de demonstrar o comportamento.
- Atualize documentação e contratos na mesma alteração que modificar uma decisão pública.
- Não mova código para `shared` antes de existir reutilização concreta.

## Padrão de commits

Use Conventional Commits, em português ou inglês de forma consistente dentro da alteração:

```text
<tipo>(<escopo opcional>): <descrição curta no imperativo>
```

Tipos principais:

- `feat`: nova capacidade observável.
- `fix`: correção de comportamento.
- `refactor`: mudança interna sem alterar comportamento.
- `test`: criação ou ajuste de testes.
- `docs`: documentação.
- `chore`: manutenção e ferramentas.
- `build`: sistema de build ou dependências.
- `ci`: integração e entrega contínuas.

Exemplo: `chore(monorepo): configure turbo workspaces`.

Commits devem ser pequenos e coesos. Mudanças incompatíveis exigem `!` após o tipo/escopo e uma
explicação `BREAKING CHANGE` no corpo.

## Checklist antes de finalizar qualquer tarefa

- [ ] O trabalho respeita o escopo e os critérios da tarefa.
- [ ] A responsabilidade está no módulo e na camada corretos.
- [ ] Não há funcionalidade, abstração ou dependência fora do necessário.
- [ ] Nomes e organização seguem os padrões do projeto.
- [ ] Não foram adicionados segredos, dados pessoais ou logs sensíveis.
- [ ] Erros e estados inválidos relevantes foram considerados.
- [ ] Testes adequados foram criados ou atualizados quando houver comportamento.
- [ ] `npm run check` foi executado com sucesso.
- [ ] `npm run build` foi executado quando a alteração afetar compilação.
- [ ] Documentação e contratos públicos estão atualizados.
- [ ] O diff foi revisado e não contém arquivos gerados ou mudanças não relacionadas.
- [ ] A mensagem de commit segue Conventional Commits.
