# Sprint Beta-11B — Painel Administrativo

## Entrega

O painel administrativo é uma aplicação React/Vite servida pelo próprio backend em `/admin`.
Todas as operações usam `/api/admin` e passam por autenticação JWT e verificação explícita da role
`ADMIN`. A interface está preparada para tema claro/escuro, desktop e telas compactas.

O domínio é isolado por `organizationId`: um administrador só consulta ou altera professores e
alunos da própria instituição. E-mails são únicos, sem distinção de caixa, dentro de cada
instituição. Os aplicativos Electron usam `organizationSlug` em `config.json`; distribuições de
outras instituições devem receber o slug correspondente.

## Primeiro administrador

Nenhum usuário é criado por migration ou seed. O fluxo definitivo de onboarding cria a instituição
e seu primeiro administrador mediante a chave operacional `ADMIN_ONBOARDING_KEY`. Sem essa variável,
o endpoint fica desativado.

```http
POST /api/auth/onboard-organization
Content-Type: application/json

{
  "organizationName": "Instituição Exemplo",
  "organizationSlug": "instituicao-exemplo",
  "name": "Administrador Geral",
  "email": "admin@instituicao.edu.br",
  "password": "uma-senha-forte",
  "confirmPassword": "uma-senha-forte",
  "setupKey": "valor-configurado-em-ADMIN_ONBOARDING_KEY"
}
```

O endpoint possui rate limit, valida senha, usa bcrypt e recusa criar um segundo ADMIN para uma
instituição já provisionada. Depois do onboarding, professores e alunos são cadastrados no painel.

## API administrativa

| Método   | Rota                                  | Finalidade                                     |
| -------- | ------------------------------------- | ---------------------------------------------- |
| `GET`    | `/api/admin/dashboard`                | Indicadores institucionais                     |
| `GET`    | `/api/admin/users`                    | Lista paginada por role, nome, e-mail e status |
| `POST`   | `/api/admin/users`                    | Cadastro de professor ou aluno                 |
| `PUT`    | `/api/admin/users/:id`                | Alteração de nome e e-mail                     |
| `PUT`    | `/api/admin/users/:id/status`         | Ativação, inativação e bloqueio                |
| `POST`   | `/api/admin/users/:id/reset-password` | Redefinição de senha e revogação das sessões   |
| `POST`   | `/api/admin/users/:id/avatar`         | Upload PNG, JPEG ou WebP de até 2 MB           |
| `GET`    | `/api/admin/users/:id/avatar`         | Leitura autenticada do avatar                  |
| `DELETE` | `/api/admin/users/:id/avatar`         | Remoção do avatar                              |
| `DELETE` | `/api/admin/users/:id`                | Exclusão lógica e anonimização                 |

O dashboard é atualizado a cada dez segundos. Presença online usa os gerenciadores em tempo real;
atendimentos e totais usam a persistência PostgreSQL. Listas aceitam `page` e `pageSize`, limitado a
100 registros por requisição.

## Segurança e histórico

- Bloqueio, inativação, exclusão e reset de senha revogam tokens e desconectam imediatamente os
  sockets ativos do usuário.
- A exclusão é lógica e anonimiza credenciais/dados pessoais. Perfis técnicos são preservados para
  manter a integridade do histórico de atendimentos.
- Avatares ficam no PostgreSQL (`BYTEA`), sem dependência do filesystem efêmero do container.
- Uploads são limitados, conferidos por MIME e assinatura binária e nunca executados.
- A auditoria grava ator, ação, alvo, instituição, data/hora automática e IP/User-Agent quando
  disponíveis.
- ADMINs não aparecem nas telas de gestão e não podem ser alterados por essas rotas.

## Execução

```bash
npm run dev          # API em http://localhost:3000
npm run dev:admin    # Vite em http://localhost:4173/admin/
npm run build-admin
```

Em produção, `npm run build-backend`, Docker e Nixpacks também compilam o painel. O backend entrega
os arquivos estáticos e o fallback da SPA em `/admin`.
