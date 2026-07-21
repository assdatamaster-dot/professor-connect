# Deploy

Os artefatos executáveis de entrega ficam junto dos respectivos pontos de composição:

- `services/backend/Dockerfile` para desenvolvimento e produção;
- `docker-compose.production.yml` para VPS com Docker Compose;
- configurações Electron Builder nos dois `package.json` dos clientes;
- automações em `scripts/` e scripts npm na raiz.

Os procedimentos completos ficam em `docs/deploy/`. Este diretório permanece reservado para
futuros manifests que não pertençam diretamente a um serviço ou aplicação.
