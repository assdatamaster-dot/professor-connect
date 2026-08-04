# Sprint Beta-11A — Cadastro, autenticação e usuários

Data da auditoria: 2026-08-04  
Escopo: API, Prisma/PostgreSQL, JWT, refresh tokens, Electron professor/aluno e regressão dos recursos existentes.

## Resultado

A Sprint foi implementada sem contas artificiais, seed de usuários ou configuração manual do banco. O seed opcional sincroniza somente dados de referência (organização pública, roles e permissões); professor e aluno nascem exclusivamente pelo cadastro público.

## API

- `POST /auth/register` e `/api/auth/register`: cadastro transacional de professor ou aluno, perfil associado e sessão inicial.
- `POST /auth/login` e `/api/auth/login`: login por e-mail e senha.
- `POST /auth/refresh` e `/api/auth/refresh`: rotação atômica do refresh token com detecção de reutilização.
- `POST /auth/logout` e `/api/auth/logout`: revogação da família da sessão corrente.
- `GET /users/me` e `/api/users/me`: nome, e-mail, role, avatar, status e último login.
- `PUT /users/me` e `/api/users/me`: nome, avatar HTTPS e senha; campos imutáveis são recusados pelo schema estrito.

## Banco de dados

A migration `20260804090000_user_registration_and_profiles`:

- adiciona `avatar_url` e `last_login_at` a `users`;
- cria a organização pública usada pelo autoatendimento;
- sincroniza roles, permissões e seus relacionamentos;
- cria índice único funcional em `LOWER(email)` para garantir unicidade sem diferenciar caixa;
- não insere nenhum usuário.

O fluxo de produção já executa `prisma migrate deploy` antes da API no Docker/EasyPanel. A migration foi validada estaticamente pelo Prisma e pelos testes de prontidão. Não havia instância local de PostgreSQL nem Docker disponível para uma aplicação real da migration nesta auditoria.

## Segurança

- senhas usam bcrypt com custo configurável e nunca são serializadas;
- política mínima de 12 caracteres com maiúscula, minúscula, número e símbolo;
- comparação bcrypt também ocorre para e-mail inexistente, reduzindo enumeração por tempo;
- refresh tokens persistem somente como SHA-256, possuem expiração e rotação por família;
- troca de senha revoga todas as sessões e devolve os apps à tela de login;
- IPC valida origem, tamanho, tipo e lista permitida de campos;
- cadastro e login têm rate limiting dedicado;
- avatar aceita somente URL HTTPS;
- roles, status, IDs, e-mail e demais campos não editáveis são bloqueados;
- auditoria registra cadastro, login, falha de login, refresh, logout, alteração de senha e perfil;
- `npm audit` final: zero vulnerabilidades conhecidas.

## Electron

Os dois aplicativos possuem telas próprias de login e cadastro, feedback de força/confirmação de senha, animações curtas, perfil e logout. A role do cadastro é imposta no processo principal (`TEACHER` no app do professor e `STUDENT` no app do aluno), não confiada ao renderer.

A sessão continua armazenada por `safeStorage`. Na reabertura, o refresh token é efetivamente validado e rotacionado antes da entrada automática; sessão expirada ou revogada é apagada. A atualização de perfil não reinicia nem desconecta uma sessão de atendimento ativa; o novo nome é adotado pela presença na próxima conexão normal.

## Regressão e qualidade

- lint: 13/13 workspaces aprovados;
- TypeScript: 13/13 workspaces aprovados;
- testes: 131 aprovados, zero falhas;
- build: 13/13 workspaces aprovados;
- Prisma schema: válido;
- Prettier: aprovado;
- `git diff --check`: aprovado;
- auditoria de dependências: zero vulnerabilidades.

As suítes aprovadas cobrem API, autenticação compartilhada, Prisma/migrations, WebSocket, WebRTC, mídia, compartilhamento de tela, controle remoto, transferência de arquivos, persistência e ambos os aplicativos Electron.

Durante a auditoria, o teste de congestionamento do controle remoto foi estabilizado para aguardar a drenagem real do transporte antes de restaurá-lo; isso removeu uma condição de corrida do teste sem alterar o comportamento de produção.

## Limitação de ambiente

A inspeção visual automatizada das telas pelo navegador embutido não pôde ser executada porque o conector não recebeu o contexto de segurança exigido. A interface foi verificada por compilação dos renderers, validação ESM, testes estruturais de HTML/CSP e revisão de CSS, mas não por captura visual automatizada nesta máquina.
