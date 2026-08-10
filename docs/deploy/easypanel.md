# Deploy no EasyPanel

Este roteiro publica o backend a partir do Dockerfile do monorepo. O EasyPanel cria a imagem do
repositório, executa o contêiner e configura o proxy HTTPS para HTTP e Socket.IO.

## 1. Preparar a VPS

Use uma VPS Linux limpa, preferencialmente Ubuntu, com pelo menos 2 GB de RAM. As portas `80` e
`443` devem estar livres e permitidas no firewall. Instale o EasyPanel conforme o
[guia oficial](https://easypanel.io/docs).

Configure no DNS um registro `A` para o domínio do backend apontando para o IPv4 da VPS, por
exemplo `api.professor-connect.example`.

## 2. Criar o projeto e o serviço

1. entre no painel e crie um projeto chamado `professor-connect`;
2. dentro do projeto, clique em **New > App** e nomeie o serviço `backend`;
3. em **Source**, selecione o repositório Git e a branch/tag aprovada;
4. para repositório privado, cadastre no provedor a chave SSH exibida pelo serviço;
5. selecione o builder **Dockerfile**;
6. use a raiz do repositório como contexto e informe
   `services/backend/Dockerfile` como caminho do Dockerfile;
7. não informe comando de start: o `CMD` da imagem inicia a API compilada.

O estágio final do Dockerfile é `production`, portanto não é necessário informar um target no
EasyPanel. Consulte o [App Service oficial](https://easypanel.io/docs/services/app) para as opções
de fonte, Dockerfile, ambiente, domínio e proxy.

O `ENTRYPOINT` executa `npm run backend:prepare`, que regenera o Prisma Client, executa a
recuperação segura de migrations conhecidas, aplica `prisma migrate deploy` e confirma
`prisma migrate status`. A API só é iniciada depois que todos os comandos terminam com sucesso.
O entrypoint continua ativo mesmo quando o campo **Command** do
EasyPanel substitui o `CMD`; ainda assim, prefira deixar **Command** e **Arguments** vazios. Se o
serviço for criado com Nixpacks em vez do Dockerfile, o `nixpacks.toml` usa `npm run start` e
preserva a mesma sequência pelo `prestart`.

## 3. Configurar as variáveis

Em **Environment**, adicione:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
REQUEST_TIMEOUT_MS=60000
HEARTBEAT_INTERVAL_MS=30000
HEARTBEAT_TIMEOUT_MS=90000
RECONNECT_WINDOW_MS=90000
DATABASE_URL=postgresql://USER:SENHA@HOST:5432/NOME_EXATO_DO_BANCO
JWT_ACCESS_SECRET=<segredo-aleatorio-exclusivo-com-32-ou-mais-caracteres>
JWT_REFRESH_SECRET=<outro-segredo-aleatorio-com-32-ou-mais-caracteres>
JWT_ISSUER=professor-connect
JWT_AUDIENCE=professor-connect-clients
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
BCRYPT_ROUNDS=12
TRUST_PROXY=true
CORS_ORIGINS=
UPDATE_ARTIFACTS_PATH=/app/release-updates
APP_GIT_SHA=<sha-completo-do-commit-publicado>
APP_BUILD_DATE=<data-iso-do-build>
```

Copie host, porta, usuário e **nome do banco** da seção **Credentials** do PostgreSQL no EasyPanel.
Não digite o nome por aproximação: `professorconnect` e `professor_connect` são bancos distintos.
No primeiro log do backend, o evento `Destino PostgreSQL configurado` mostra host, porta, banco e
schema efetivos sem revelar usuário ou senha. O evento `Banco de dados validado`, emitido antes de
`Servidor iniciado`, confirma o nome retornado pelo próprio PostgreSQL, todas as migrations e as
tabelas esperadas.

`REQUEST_TIMEOUT_MS` limita somente solicitações de atendimento ainda não respondidas. Ele não
define duração para uma sessão nem para o controle remoto já autorizado.

Não copie `BACKEND_BIND_ADDRESS`, `BACKEND_PORT` ou `PROFESSOR_CONNECT_IMAGE`; elas existem apenas
para o Compose. `DATABASE_URL` é obrigatória e deve apontar para PostgreSQL persistente. Gere os
dois segredos JWT separadamente e nunca os registre no repositório ou nos logs. `CORS_ORIGINS`
pode ficar vazio para clientes Electron; inclua origens HTTPS separadas por vírgula ao publicar
um cliente web.

`APP_GIT_SHA` e `APP_BUILD_DATE` não são segredos. Eles identificam a imagem em `/api/health` e
devem corresponder ao commit e à data promovidos. Se a plataforma também oferece build args,
forneça `GIT_SHA`, `BUILD_DATE` e `APP_VERSION` com os mesmos valores para preencher os labels OCI.

No primeiro acesso a `/admin`, o painel detecta automaticamente o banco vazio e abre o Assistente
de Configuração. Organização, administrador e preferências são criados pela interface; não há chave
de onboarding nem chamada manual de API.

## 4. Configurar domínio e proxy

1. em **Domains & Proxy**, adicione o domínio preparado no DNS;
2. marque-o como domínio principal;
3. configure a porta do proxy como `3000` e protocolo HTTP;
4. ative o certificado Let's Encrypt oferecido pelo EasyPanel;
5. não publique a porta `3000` na seção **Ports** para um serviço web público.

O mesmo endpoint HTTPS atende Express e o upgrade WebSocket do Socket.IO. A URL usada pelos
clientes deve ser o domínio HTTPS, nunca o IP/porta interna do contêiner.

O proxy deve preservar `Host`/`X-Forwarded-Host` e `X-Forwarded-Proto`, como ocorre na configuração
padrão do EasyPanel. Com `TRUST_PROXY=true`, o backend reconhece a origem HTTPS pública como a
própria origem e mantém bloqueadas somente origens externas que não estejam em `CORS_ORIGINS`.

## 5. Configurar o volume de atualizações Windows

O build Git do EasyPanel não leva `release-updates/`: o diretório contém binários gerados e é
ignorado pelo repositório. Em **Mounts**, crie um Volume persistente chamado `windows-updates` com
`mountPath` `/app/release-updates`. Sem esse mount, `/updates/teacher/latest.yml` e
`/updates/student/latest.yml` não existem e nenhum aplicativo Windows consegue atualizar.

O GitHub Actions transfere as releases por SSH para o caminho real desse volume no host. Cadastre
esse caminho como `UPDATE_DEPLOY_PATH` no environment `desktop-production`; o usuário SSH deve
escrever no volume e o usuário `node` do container deve somente lê-lo. A publicação usa
`.staging`, diretórios imutáveis em `.releases` e um link `.current`, portanto o filesystem que
serve o mount deve aceitar e preservar links simbólicos. Não armazene chave SSH ou credencial do
painel no repositório.

Antes da primeira release, confirme pelo console que `/app/release-updates/teacher` e `student`
não são diretórios reais antigos. O promotor recusa substituí-los automaticamente para não apagar
dados. Faça backup e migração inicial em janela controlada, se necessário. Consulte
[Pipeline de release](./release-pipeline.md) para o layout exato, secrets e rollback, e
[Auto Update](./auto-update.md) para o procedimento A → B.

A documentação oficial do EasyPanel explica que dados do container são descartados no restart e
que Mounts do tipo Volume criam armazenamento persistente compartilhável entre containers:
<https://easypanel.io/docs/services/app#mounts>.

## 6. Publicar e validar

Clique em **Deploy** e acompanhe os logs. Em um banco novo, antes de `Servidor iniciado`, devem
aparecer a geração do Prisma Client e a aplicação de todas as migrations. Em deploys seguintes,
`prisma migrate deploy` informa que não há migrations pendentes. Somente então abra:

```text
https://api.professor-connect.example/health
```

Se uma execução anterior da Beta-12B estiver marcada como failed, a nova imagem identifica o erro
PostgreSQL `55P04`, executa o `resolve --rolled-back` autorizado e continua o deploy
automaticamente. Para repetir o procedimento de forma idempotente pelo **Console** do backend:

```bash
cd /app
npm run backend:recover-migration
```

O script recusa qualquer migration ou causa que não esteja na allowlist auditada. Consulte o
[procedimento de recuperação de migrations](./prisma-migration-recovery.md) antes de autorizar uma
nova regra.

Antes de abrir o painel, use o **Console** do serviço backend para uma auditoria somente leitura:

```bash
npm run prisma:status
npm run prisma:pull:print
```

O primeiro comando deve informar que todas as migrations foram encontradas e que o banco está
atualizado.
O segundo imprime o schema introspectado sem sobrescrever `prisma/schema.prisma`. Somente então
consulte a saúde da aplicação. Resposta esperada:

As migrations embarcadas, na ordem, são:

1. `20260731090000_identity_and_access`;
2. `20260731091000_support_workflow`;
3. `20260731091500_protocol_workflow`;
4. `20260731092000_events_audit_and_transfers`;
5. `20260803090000_authentication_security`;
6. `20260804090000_user_registration_and_profiles`;
7. `20260805090000_administrative_panel`;
8. `20260805150000_intelligent_attendance_flow`;
9. `20260805180000_bootstrap_first_run`;
10. `20260805220000_cleanup_bootstrap_artifacts`;
11. `20260806090000_beta_12a_file_transfer_manager`;
12. `20260806145900_beta_12b_session_status_values`;
13. `20260806150000_beta_12b_session_recovery`;
14. `20260806180000_beta_12c_intelligent_auto_update`;
15. `20260810120000_professor_attendance_queue`.

```json
{
  "status": "ok",
  "version": "0.1.3",
  "gitSha": "<sha-completo>",
  "buildDate": "<data-iso>",
  "environment": "production"
}
```

Confirme também `/api/health` e os feeds antes de liberar clientes:

```powershell
npm run updates:diagnose
npm run updates:diagnose -- --download
```

Mantenha **1 réplica**. Identidade, refresh tokens, auditoria e histórico são persistidos, mas a
coordenação de sockets ativos ainda exige uma única réplica até a adoção de um adapter distribuído.

Valide também o HTML, os assets versionados, os MIME types e o comportamento CORS da publicação:

```bash
npm run verify-admin-publication -- https://api.professor-connect.example
```

O comando deve listar cada arquivo em `/admin/assets/` com HTTP 200 e terminar com a confirmação
de que o painel foi publicado corretamente. Um asset inexistente deve responder 404, nunca receber
o fallback HTML da SPA.

## 7. Atualizar

1. publique o commit/tag aprovado no repositório;
2. confirme que os checks e a imagem de produção passaram no CI ou em uma estação com Docker;
3. altere a referência da branch/tag no serviço, quando aplicável;
4. clique em **Deploy** novamente;
5. valide `/health` e os logs após a substituição do contêiner.

Para rollback, selecione novamente a tag/commit estável anterior e faça um novo deploy. Toda troca
de contêiner descarta o estado em memória e encerra atendimentos ativos; use uma janela de
manutenção.

## Checklist

- DNS resolvendo para a VPS;
- Dockerfile localizado a partir da raiz do repositório;
- banco persistente e variáveis de autenticação configurados;
- logs mostram o destino PostgreSQL sanitizado, `prisma generate`, `prisma migrate deploy`,
  `prisma migrate status` e a validação de 24 tabelas antes de `Servidor iniciado`;
- nenhum comando de start personalizado contorna o `CMD` da imagem;
- proxy apontando para a porta `3000`;
- HTTPS válido;
- volume `windows-updates` persistente montado em `/app/release-updates`;
- `latest.yml`, instalador, blockmap e `release-info.json` dos dois apps respondendo HTTP 200;
- manifests sem cache e hashes locais/remotos aprovados por `updates:diagnose -- --download`;
- exatamente uma réplica;
- `/health` retornando HTTP 200;
- `/admin` e todos os `/admin/assets/*.js|css` retornando HTTP 200 com MIME correto;
- `npm run verify-admin-publication -- https://<domínio>` aprovado;
- logs sem segredos ou erros de configuração.
