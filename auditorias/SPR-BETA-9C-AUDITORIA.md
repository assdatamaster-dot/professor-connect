# Auditoria BETA-9C — identidade e controle de acesso

Data: 2026-08-03

## Resultado executivo

Antes desta Sprint, apenas `GET /health` e três grupos de leitura (`professors`, `students` e `sessions`) existiam na API; todas as rotas eram anônimas. O Socket.IO aceitava qualquer handshake e os gateways de presença confiavam em nome, `studentId` e `clientId` enviados pelo cliente. WebRTC, controle remoto e arquivos já exigiam participação em uma sessão ativa, mas essa sessão podia nascer de uma identidade autodeclarada. Os aplicativos Electron não tinham sessão de autenticação.

A implementação BETA-9C fecha essa cadeia: a identidade nasce no banco, entra na API por JWT validado, entra no Socket.IO pelo handshake e substitui os identificadores autodeclarados nos registros de presença. A autorização de WebRTC continua vinculada à sessão ativa, agora composta exclusivamente por perfis autenticados da mesma instituição.

## Superfície HTTP

| Método e caminho                      | Classificação      | Controle                                               |
| ------------------------------------- | ------------------ | ------------------------------------------------------ |
| `GET /health`                         | Público            | Saúde, sem dados sensíveis                             |
| `GET /api/auth/providers`             | Público            | Somente capacidades habilitadas                        |
| `POST /api/auth/login`                | Público controlado | Validação estrita e rate limit de login                |
| `POST /api/auth/refresh`              | Público controlado | JWT refresh, hash persistido, rotação e rate limit     |
| `GET /api/auth/me`                    | Privado            | Bearer access token                                    |
| `GET /api/auth/sessions`              | Privado            | Somente sessões do próprio usuário                     |
| `DELETE /api/auth/sessions/:familyId` | Privado            | Revogação restrita ao próprio usuário                  |
| `POST /api/auth/logout`               | Privado            | Revoga a família atual                                 |
| `POST /api/auth/logout-all`           | Privado            | Revoga todas as famílias do usuário                    |
| `POST /api/auth/change-password`      | Privado            | Confirma senha atual, bcrypt e revoga todas as sessões |
| `GET /api/professors/online`          | Privado            | `professors.online.read`, mesma instituição            |
| `GET /api/students/online`            | Privado            | `students.online.read`, mesma instituição              |
| `GET /api/sessions/*`                 | Privado            | `sessions.read`; admin ou participante do recurso      |

## Socket.IO, WebRTC e recursos sensíveis

O servidor registra middleware antes de qualquer gateway. O handshake exige access token, usuário ativo, sessão não revogada, instituição e `socket.connect`. A identidade é armazenada em `socket.data.identity`. O evento `auth:refresh` permite renovar a credencial sem interromper uma chamada e proíbe trocar usuário, instituição ou família de sessão.

Eventos auditados/mapeados:

- protocolo principal: conexão, heartbeat, presença, solicitação, chamada e sessão;
- presença legada: `professor:*` e `student:*`;
- atendimento: `request:session`, `session:*`;
- sinalização: offer, answer e ICE;
- compartilhamento: start/stop;
- controle remoto: request, approved, denied, mouse, keyboard e stop;
- arquivos: metadados de auditoria vinculados à sessão.

O backend deriva `profileId`, `displayName`, papel e instituição do token. IDs presentes em payloads continuam existindo apenas como referência ao recurso/destinatário; nunca definem a identidade do emissor. O roteamento WebRTC, tela, controle remoto e arquivos passa pelo `SessionManager`, que confirma socket participante e sessão ativa.

## Persistência e identidade

O Prisma/PostgreSQL contém `Organization`, `User`, `Role`, `Permission`, associações RBAC, perfis `Professor`/`Student`, `AuthToken`, `ExternalIdentity`, presença, solicitações, sessões, chamadas, arquivos e logs. `ExternalIdentity` é o ponto de extensão para Google, Microsoft, LDAP ou outro provedor; nenhum deles foi habilitado nesta Sprint.

Senhas usam bcrypt com custo configurável (12 por padrão). Refresh tokens são JWTs assinados, mas o banco recebe somente SHA-256 do token completo. Cada login cria uma família; cada refresh revoga o token anterior e cria outro na mesma família. Reutilizar um token rotacionado revoga toda a família. O access token curto é validado junto com a existência de uma sessão ativa, tornando logout e revogação efetivos antes da expiração nominal do JWT.

## Electron

Os dois aplicativos usam login/senha via IPC com origem conferida. O renderer nunca recebe acesso ao filesystem, `safeStorage` ou primitivas Node. Access e refresh token ficam no processo principal e são persistidos em arquivo cifrado pelo `safeStorage`; se a criptografia do sistema operacional não estiver disponível, a sessão fica somente em memória. Não há `localStorage`. O cliente renova tokens com exclusão mútua, repete uma chamada HTTP uma vez após 401 e atualiza a credencial do socket periodicamente.

As janelas já estavam corretamente isoladas (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), com navegação externa bloqueada e política de permissão de mídia restrita ao renderer principal.

## Controles de segurança

- Helmet e remoção de `X-Powered-By`;
- CORS por allowlist, com clientes sem `Origin` permitidos para Electron;
- JSON limitado a 64 KiB e Zod em entradas de autenticação;
- rate limit global, de login e refresh;
- JWT HS256 com algoritmo, emissor e audiência fixados e segredos distintos obrigatórios em produção;
- resposta uniforme a credenciais inválidas, sem enumeração de usuários;
- senha forte na troca, bcrypt, rotação/reuso de refresh e revogação imediata;
- RBAC reutilizável e isolamento por instituição/participante;
- auditoria de sucesso/falha de login, refresh, logout, revogação, troca de senha e reutilização; eventos de sessão já auditados pela camada de persistência.

## Pontos operacionais

Produção deve fornecer `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` e uma allowlist `CORS_ORIGINS` quando houver cliente web. Os segredos devem ser independentes e ter no mínimo 32 caracteres. O deploy executa migrations Prisma antes de iniciar a versão nova. Contas de bootstrap só devem ser criadas conscientemente por `prisma:seed`, com `SEED_PASSWORD` secreta e posterior troca de senha.
