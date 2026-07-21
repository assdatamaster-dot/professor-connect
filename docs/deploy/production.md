# Ambiente de produção

O backend de produção é a API Express com Socket.IO na porta interna `3000`. Presence, Requests,
Sessions, Calls e heartbeat continuam em memória, conforme o MVP-3: reiniciar o processo encerra o
estado ativo. Esta Sprint não adiciona banco, autenticação ou qualquer nova regra de negócio.

## Artefatos

- `services/backend/Dockerfile`: desenvolvimento e imagem final otimizada em múltiplos estágios;
- `docker-compose.production.yml`: execução local ou em VPS com health check;
- `.env.example`: catálogo de configuração sem segredos;
- `scripts/deploy-production.mjs`: build, publicação e espera pelo health check;
- `npm run build-backend`: build somente do grafo necessário à API.

## Variáveis

| Variável                  | Obrigatória      | Padrão                            | Uso                          |
| ------------------------- | ---------------- | --------------------------------- | ---------------------------- |
| `NODE_ENV`                | sim em produção  | `production`                      | modo do processo Node        |
| `HOST`                    | sim no contêiner | `0.0.0.0`                         | interface interna de escuta  |
| `PORT`                    | sim no contêiner | `3000`                            | porta interna HTTP/Socket.IO |
| `REQUEST_TIMEOUT_MS`      | não              | `60000`                           | expiração de Requests        |
| `HEARTBEAT_INTERVAL_MS`   | não              | `30000`                           | intervalo de heartbeat       |
| `HEARTBEAT_TIMEOUT_MS`    | não              | `90000`                           | limite do heartbeat          |
| `RECONNECT_WINDOW_MS`     | não              | `90000`                           | janela de reconexão          |
| `BACKEND_BIND_ADDRESS`    | somente Compose  | `127.0.0.1`                       | endereço publicado no host   |
| `BACKEND_PORT`            | somente Compose  | `3000`                            | porta publicada no host      |
| `PROFESSOR_CONNECT_IMAGE` | somente Compose  | `professor-connect-backend:0.1.0` | nome/tag local da imagem     |

O intervalo do heartbeat deve ser menor que o timeout, e a janela de reconexão não pode superar o
timeout. As variáveis `WEBRTC_*` pertencem aos clientes; `DATABASE_URL` está reservada e ainda não
é consumida pelo backend.

## Build sem Docker

```powershell
npm ci
npm run build-backend
$env:NODE_ENV = 'production'
$env:HOST = '0.0.0.0'
$env:PORT = '3000'
npm start
```

Valide em outro terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

A resposta esperada é `{ "status": "ok" }`.

## Build da imagem

```bash
docker build \
  --file services/backend/Dockerfile \
  --target production \
  --tag professor-connect-backend:0.1.0 \
  .
```

O estágio de prune seleciona apenas o grafo da API. O runtime final contém dependências de
produção e JavaScript compilado, roda sem privilégios como `node` e possui `HEALTHCHECK` próprio.

## Deploy com Docker Compose

Crie a configuração local e revise principalmente o endereço publicado:

```bash
cp .env.example .env.production
```

Para acesso direto pela rede, altere `BACKEND_BIND_ADDRESS` para `0.0.0.0` e proteja a porta com
firewall/TLS. Se houver proxy reverso no mesmo host, mantenha `127.0.0.1`.

Publique e espere o contêiner ficar saudável:

```bash
npm run deploy-production
```

Para usar outro arquivo:

```bash
npm run deploy-production -- --env-file .env.vps
```

Comandos operacionais:

```bash
docker compose --file docker-compose.production.yml --env-file .env.production ps
docker compose --file docker-compose.production.yml --env-file .env.production logs --follow backend
docker compose --file docker-compose.production.yml --env-file .env.production down
```

O modo de validação do comando, sem alterar contêineres, é:

```bash
npm run deploy-production -- --dry-run
```

## Atualização e rollback

1. faça backup de qualquer configuração externa à imagem;
2. obtenha o commit/tag aprovado;
3. altere `PROFESSOR_CONNECT_IMAGE` para uma tag imutável da versão;
4. execute `npm ci`, os checks e `npm run deploy-production`;
5. confirme `GET /health` e acompanhe os logs.

Para rollback, restaure o commit anterior ou a tag anterior em `PROFESSOR_CONNECT_IMAGE` e execute
novamente o deploy. Como o estado é em memória, atualização e rollback interrompem atendimentos
ativos; planeje uma janela de manutenção.

## Segurança e operação

- exponha o serviço público somente atrás de HTTPS/WSS;
- mantenha apenas uma réplica nesta arquitetura, pois o estado e as conexões Socket.IO são locais;
- não versione `.env.production`, certificados ou credenciais TURN;
- permita as portas 80/443 no proxy e mantenha `3000` restrita quando possível;
- monitore o health check e os logs do processo;
- não adicione volume: a versão atual não possui dados persistentes do backend.
