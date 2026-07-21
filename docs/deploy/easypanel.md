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
```

Não copie `BACKEND_BIND_ADDRESS`, `BACKEND_PORT` ou `PROFESSOR_CONNECT_IMAGE`; elas existem apenas
para o Compose. `DATABASE_URL` e `WEBRTC_*` não são necessárias para executar o backend Beta-1A.
Não configure mount ou banco para esta versão.

## 4. Configurar domínio e proxy

1. em **Domains & Proxy**, adicione o domínio preparado no DNS;
2. marque-o como domínio principal;
3. configure a porta do proxy como `3000` e protocolo HTTP;
4. ative o certificado Let's Encrypt oferecido pelo EasyPanel;
5. não publique a porta `3000` na seção **Ports** para um serviço web público.

O mesmo endpoint HTTPS atende Express e o upgrade WebSocket do Socket.IO. A URL usada pelos
clientes deve ser o domínio HTTPS, nunca o IP/porta interna do contêiner.

## 5. Publicar e validar

Clique em **Deploy** e acompanhe os logs de build. Quando o serviço estiver em execução, abra:

```text
https://api.professor-connect.example/health
```

Resposta esperada:

```json
{
  "status": "ok"
}
```

Mantenha **1 réplica**. O backend atual guarda Presence, Requests, Sessions, Calls e sockets em
memória; múltiplas réplicas não compartilham esse estado e estão fora da arquitetura Beta-1A.

## 6. Atualizar

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
- sete variáveis de backend configuradas;
- proxy apontando para a porta `3000`;
- HTTPS válido;
- exatamente uma réplica;
- `/health` retornando HTTP 200;
- logs sem segredos ou erros de configuração.
