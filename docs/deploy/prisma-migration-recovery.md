# Recuperação segura de migrations Prisma

O comando operacional do backend é:

```bash
npm run backend:recover-migration
```

Ele usa a `DATABASE_URL` do próprio serviço e executa o seguinte fluxo:

1. consulta somente registros ativos com `finished_at IS NULL` e
   `rolled_back_at IS NULL` em `_prisma_migrations`;
2. se não houver falhas, pula o `resolve` e executa `prisma migrate deploy`;
3. se encontrar a Beta-12B com o erro auditado PostgreSQL `55P04`, executa
   `prisma migrate resolve --rolled-back
20260806150000_beta_12b_session_recovery`;
4. consulta novamente `_prisma_migrations` e somente continua se não restar
   falha ativa;
5. executa `prisma migrate deploy`.

O script nunca resolve automaticamente uma migration desconhecida ou a
Beta-12B com uma causa diferente. Nesses casos, termina com erro antes de
alterar o histórico. Novas regras de recuperação devem ser adicionadas à
allowlist em `migration-recovery.ts` somente depois de auditoria da causa,
confirmação de que a nova tentativa é segura e criação de teste de regressão.

## Idempotência e concorrência

Executar o comando repetidamente é seguro:

- uma migration concluída não é selecionada como falha;
- uma migration já marcada como `rolled_back` não é resolvida outra vez;
- `migrate deploy` aplica somente migrations pendentes;
- se duas instâncias iniciarem simultaneamente e uma resolver primeiro, a outra
  confirma o estado atualizado e continua com o deploy;
- o lock de migrations do Prisma serializa a aplicação das migrations.

O procedimento não remove migrations, não apaga `_prisma_migrations`, não usa
`migrate reset` nem executa SQL de alteração de dados diretamente. As únicas
mudanças são o registro `rolled_back_at` produzido pelo comando oficial
`migrate resolve` e as migrations versionadas aplicadas por `migrate deploy`.

## EasyPanel

O `backend:prepare` executado pelo entrypoint da imagem chama automaticamente
`backend:recover-migration`. Portanto, para recuperar a falha conhecida, basta
publicar a nova imagem/revisão no EasyPanel; não é necessário substituir o
entrypoint nem abrir acesso externo ao PostgreSQL.

Para executar ou repetir explicitamente pelo **Console** do serviço backend:

```bash
cd /app
npm run backend:recover-migration
```

O comando deve ser executado no serviço backend, onde `DATABASE_URL` já está
configurada. Não copie a credencial para argumentos de linha de comando.

Depois, confirme:

```bash
npm run prisma:status
```

Não execute `prisma migrate resolve --applied`, `prisma migrate reset`,
`prisma db push`, `DELETE FROM _prisma_migrations` ou qualquer `DROP` como parte
desse procedimento.
