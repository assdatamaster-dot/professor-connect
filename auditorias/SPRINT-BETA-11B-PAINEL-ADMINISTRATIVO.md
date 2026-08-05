# Auditoria — Sprint Beta-11B

Data original: 2026-08-04

Reauditoria e conclusão: 2026-08-05

## Resultado

A Sprint Beta-11B introduz o painel web administrativo, gestão institucional de professores e
alunos, onboarding seguro do primeiro administrador, dashboard, avatares, status, auditoria e
desconexão imediata de usuários revogados. A implementação mantém os contratos de autenticação,
Electron, presença, WebRTC, controle remoto e transferência de arquivos existentes.

Na reauditoria integral foram encontradas e corrigidas três lacunas: contas que acumulassem a role
`ADMIN` com `TEACHER` ou `STUDENT` ainda apareciam nas listagens gerenciáveis, o build Vite
publicava source maps e a diretiva CSP `upgrade-insecure-requests` impedia os assets do painel de
carregar na pré-visualização HTTP local. As consultas e indicadores agora excluem explicitamente
qualquer ADMIN, o bundle de produção não contém `.map` nem comentário `sourceMappingURL` e a CSP
preserva o reforço de HTTPS em produção sem quebrar o fluxo local/Electron.

### Correção da publicação no EasyPanel

A verificação HTTP do domínio de produção reproduziu o erro reportado: os bundles retornavam
`200` sem `Origin`, mas `403 application/json` quando requisitados com a origem HTTPS pública. O
problema não estava no Vite, no Docker nem no `express.static()`: o middleware CORS global rejeitava
a própria origem porque `CORS_ORIGINS` estava vazio. Os atributos `crossorigin` gerados pelo Vite
faziam o navegador enviar esse cabeçalho também para JavaScript e CSS.

A correção reconhece a mesma origem por protocolo e host já normalizados pelo `TRUST_PROXY`,
incluindo `X-Forwarded-Proto` e `X-Forwarded-Host` do EasyPanel, sem liberar origens externas. O
Vite agora declara explicitamente `base: '/admin/'`, `outDir: 'dist'` e `assetsDir: 'assets'`. Assets
versionados recebem cache imutável em produção, enquanto um asset ausente retorna `404` em vez de
receber o fallback HTML da SPA. Um verificador reutilizável exercita HTML, caminhos, status, MIME,
CORS, cache e o 404 diretamente contra qualquer domínio publicado.

## Arquitetura revisada

- `apps/admin-web`: SPA React/Vite isolada, servida em `/admin` pelo backend e com proxy local no
  desenvolvimento.
- `services/backend/api/src/admin`: contratos e casos de uso administrativos sem regras no
  renderer.
- Controllers: validação Zod, conversão HTTP e mensagens de domínio amigáveis.
- Rotas: `authenticate` seguido de `requireRole('ADMIN')` em toda a superfície `/api/admin`.
- Prisma: isolamento por `organizationId`, paginação no banco e índices orientados às consultas.
- WebSocket: o gateway permite revogação por `userId`; bloqueio, inativação, exclusão e reset de
  senha encerram sockets já autenticados.
- Deploy: o grafo de build do backend inclui o frontend administrativo no Docker e no Nixpacks.

## Banco e multi-tenancy

A migration `20260805090000_administrative_panel`:

- converte os estados antigos para `ACTIVE`, `INACTIVE` e `BLOCKED`;
- adiciona `deleted_at` para exclusão lógica;
- torna o e-mail case-insensitive único por instituição;
- cria índices de listagem/status/exclusão;
- cria `user_avatars` com `BYTEA` e cascade restrito ao usuário;
- não cria nenhum usuário artificial.

A exclusão administrativa anonimiza e-mail, nome, senha e avatar, revoga sessões e preserva os IDs
de Professor/Aluno usados por atendimentos históricos. Novas instituições são provisionadas por
`POST /api/auth/onboard-organization`, protegido por `ADMIN_ONBOARDING_KEY`; migrations e seed
continuam sem contas bootstrap.

## Segurança

- Somente ADMIN acessa indicadores e mutações, mesmo que outra role receba acidentalmente a
  permission `users.manage`.
- ADMINs são excluídos das consultas de alvos gerenciáveis, inclusive em cenário de múltiplas roles.
- Senhas usam a política central e bcrypt; hashes e senhas nunca fazem parte dos DTOs de saída.
- Reset de senha revoga toda sessão do alvo.
- Status não ativo revoga tokens e desconecta conexões Socket.IO existentes.
- Upload limitado a um arquivo e 2 MB, restrito a PNG/JPEG/WebP e validado por MIME e assinatura.
- Auditorias registram ator, alvo, instituição, ação, timestamp do banco, IP e User-Agent quando
  disponíveis.
- Rate limits existentes protegem login, refresh, cadastro e onboarding.
- `npm audit` não encontrou vulnerabilidades.

## UX e performance

- Dashboard com sete indicadores e atualização automática a cada dez segundos.
- Sidebar, header, tema claro/escuro persistido e layout responsivo.
- Listagem com paginação server-side (10–100 itens), filtros independentes de nome/e-mail/status e
  debounce de 300 ms.
- Skeletons, empty states, toasts, mensagens amigáveis e confirmações fortes para exclusão.
- Formulários validam e-mail, nome, senha e confirmação em tempo real.
- Avatares usam object URLs revogadas no unmount; sem foto, exibem até duas iniciais.
- Polling, object URLs, timers, listeners e AbortControllers possuem cleanup explícito.
- Bundle de produção: JavaScript 223,38 kB (68,41 kB gzip) e CSS 19,83 kB (5,12 kB gzip), sem
  source maps públicos.

## Compatibilidade e regressão

- Electron Professor/Aluno receberam `organizationSlug` em configuração, mantendo o default
  `professor-connect` para instalações atuais.
- O login sem slug continua limitado à organização pública, eliminando ambiguidade entre tenants.
- O painel usa a mesma origem HTTP da API, compatível com proxy reverso, EasyPanel e container
  read-only.
- Em desenvolvimento, a CSP não força assets HTTP para HTTPS; em produção, o reforço
  `upgrade-insecure-requests` permanece ativo.
- Avatares persistem no PostgreSQL e não dependem do filesystem efêmero.
- A configuração Prisma foi migrada para `prisma.config.ts`, removendo o aviso de configuração
  descontinuada.
- Nenhuma alteração foi feita nos protocolos WebRTC, screen share, controle remoto ou transferência
  de arquivos; suas suítes permaneceram aprovadas.

## Evidências automatizadas

- `npm run check`: aprovado em 14 workspaces.
- Testes: 148 aprovados, zero falhas, em 16 tarefas Turbo.
- `npm run build`: 14/14 workspaces compilados; `build-backend` também aprovou API e painel React.
- `npm run prisma:validate`: schema válido.
- `npm audit --audit-level=moderate`: zero vulnerabilidades.
- `git diff --check`: nenhuma inconsistência de whitespace.

## Acesso verificado

- Produção: `https://<domínio-do-backend>/admin/`.
- Desenvolvimento Vite: `http://127.0.0.1:4173/admin/` com a API em `127.0.0.1:3000`.
- Pré-visualização auditável sem PostgreSQL: `http://127.0.0.1:4300/admin/`, iniciada por
  `npm run admin:test-preview`.
- Usuário exclusivo da pré-visualização: `admin@professor-connect.test`, instituição
  `professor-connect`, senha `Admin#ProfessorConnect2026`.

A conta acima existe somente no serviço em memória ligado ao loopback. Produção não recebe
credencial padrão: o primeiro usuário real é criado por `POST /api/auth/onboard-organization` com
`ADMIN_ONBOARDING_KEY`, e a chave deve ser desativada após o provisionamento.

## Limitações do ambiente de auditoria

O host não possui Docker, `psql` nem serviço PostgreSQL, portanto não foi possível executar a
migration contra uma instância real ou construir a imagem Docker nesta máquina. A migration foi
validada pelo Prisma, possui teste estrutural e será aplicada pelo fluxo idempotente
`prisma migrate deploy` já usado no startup.

A pré-visualização HTTP local iniciou corretamente, mas o navegador integrado recusou a conexão por
ausência da política de sandbox fornecida pelo próprio ambiente. A automação visual não foi
substituída por outro navegador para respeitar o mecanismo oficial; o frontend foi validado por
tipagem, lint, testes de regras, build Vite, HTTP real da página/assets/login/dashboard, headers de
segurança e revisão responsiva/acessível do código.
