# Auditoria da migration Beta-12B

## Diagnóstico

A migration `20260806150000_beta_12b_session_recovery` adiciona seis valores ao
enum existente `AttendanceSessionStatus` e, no mesmo arquivo, usa o novo valor
`CONNECTED` em um `UPDATE`.

O Prisma 6.19.3 envia o arquivo PostgreSQL inteiro como uma chamada
`simple_query`. O PostgreSQL executa todas as instruções desse lote dentro de
uma transação implícita. Um valor adicionado a um enum existente não pode ser
usado antes do commit da transação que o adicionou.

O primeiro comando inválido é:

```sql
UPDATE "attendance_sessions"
SET "status" = 'CONNECTED'::"AttendanceSessionStatus"
WHERE "status" = 'ACTIVE'::"AttendanceSessionStatus";
```

O PostgreSQL retorna SQLSTATE `55P04`, com a mensagem equivalente a
`unsafe use of new value "CONNECTED" of enum type "AttendanceSessionStatus"`.
Como o lote é atômico, as adições do enum, as novas colunas e a remoção do
default são revertidas. O índice e o registro de auditoria, posicionados depois
do `UPDATE`, nem chegam a ser executados.

## Auditoria dos objetos

- `AttendanceSessionStatus`, `attendance_sessions` e suas três FKs foram
  criados por `20260731091000_support_workflow`.
- `audit_logs` e `AuditSeverity.INFO` foram criados por
  `20260731092000_events_audit_and_transfers`.
- Nenhuma migration anterior cria os seis novos valores, as oito novas colunas
  ou `attendance_sessions_status_recovery_deadline_idx`.
- A Beta-12B não cria nem altera FKs. Portanto nenhuma FK é a origem da falha.
- Todos os comandos têm sintaxe válida no PostgreSQL. A incompatibilidade é a
  regra transacional do enum, não a sintaxe SQL.
- Os `ALTER TYPE ... ADD VALUE IF NOT EXISTS` são idempotentes.
- O `UPDATE`, `DROP DEFAULT` e `SET DEFAULT` convergem ao mesmo estado quando
  repetidos.
- `ADD COLUMN` e `CREATE INDEX` não usam `IF NOT EXISTS`; eles não são
  idempotentes, embora não tenham duplicata no histórico versionado.
- O `INSERT INTO audit_logs` também não é idempotente em termos de conteúdo.
  Isso não gerou duplicata porque o lote que falhou foi revertido antes de
  alcançar o `INSERT`.

## Correção permanente

Foi adicionada a migration
`20260806145900_beta_12b_session_status_values`, ordenada imediatamente antes da
Beta-12B. Ela cria os seis valores com `IF NOT EXISTS` e termina, permitindo o
commit. Quando a Beta-12B é aplicada em seguida, `CONNECTED` já é um valor
confirmado e pode ser usado pelo `UPDATE`.

A migration original não foi editada. Isso preserva seu checksum em bancos nos
quais ela já tenha sido aplicada e evita divergência do histórico. Em bancos
que já possuem os valores, a preparatória é inócua.

## Confirmação no banco de produção

Antes do `resolve`, consultar no console SQL do PostgreSQL:

```sql
SELECT
  migration_name,
  started_at,
  finished_at,
  rolled_back_at,
  applied_steps_count,
  logs
FROM "_prisma_migrations"
WHERE migration_name = '20260806150000_beta_12b_session_recovery'
ORDER BY started_at DESC;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = 'attendance_sessions'
  AND column_name IN (
    'state_updated_at',
    'recovery_deadline',
    'teacher_recovery_token_hash',
    'student_recovery_token_hash',
    'last_heartbeat_at',
    'connected_milliseconds',
    'reconnecting_milliseconds',
    'disconnect_count'
  )
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname = 'attendance_sessions_status_recovery_deadline_idx';

SELECT enumlabel
FROM pg_enum AS e
JOIN pg_type AS t ON t.oid = e.enumtypid
JOIN pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = current_schema()
  AND t.typname = 'AttendanceSessionStatus'
ORDER BY e.enumsortorder;

SELECT c.conname, c.convalidated, pg_get_constraintdef(c.oid)
FROM pg_constraint AS c
JOIN pg_class AS r ON r.oid = c.conrelid
JOIN pg_namespace AS n ON n.oid = r.relnamespace
WHERE n.nspname = current_schema()
  AND r.relname = 'attendance_sessions'
  AND c.contype = 'f'
ORDER BY c.conname;
```

Para esta falha, o log deve conter SQLSTATE `55P04`/`unsafe use of new value`,
e as oito colunas e o índice devem estar ausentes, pois o PostgreSQL reverteu o
lote completo.

## Recuperação em produção

Publicar primeiro uma revisão que contenha a migration preparatória. No mesmo
ambiente e com a mesma `DATABASE_URL` usada pelo backend:

```powershell
Set-Location services/backend/database
npx prisma migrate resolve --rolled-back 20260806150000_beta_12b_session_recovery --schema prisma/schema.prisma
npx prisma migrate deploy --schema prisma/schema.prisma
npx prisma migrate status --schema prisma/schema.prisma
```

`--rolled-back` é a opção correta: ele libera uma nova tentativa depois da
correção. Não usar `--applied`, pois isso faria o Prisma pular a Beta-12B mesmo
com suas colunas, índice e conversão de dados ausentes.

O `deploy` aplica, nesta ordem:

1. `20260806145900_beta_12b_session_status_values`;
2. uma nova tentativa de `20260806150000_beta_12b_session_recovery`;
3. migrations posteriores ainda pendentes.

Não executar `migrate reset`, `db push`, `DROP COLUMN`, `DROP TYPE` ou exclusão
manual de registros de `_prisma_migrations` em produção.

## Pós-condições

Após o deploy:

```sql
SELECT status, count(*)
FROM attendance_sessions
GROUP BY status
ORDER BY status;

SELECT count(*) AS migration_audit_count
FROM audit_logs
WHERE action = 'migration.beta-12b-session-recovery';

SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260806145900_beta_12b_session_status_values',
  '20260806150000_beta_12b_session_recovery'
)
ORDER BY started_at;
```

O resultado esperado é: nenhum status `ACTIVE`, exatamente um registro de
auditoria da Beta-12B e uma execução concluída para cada migration (além do
registro antigo da Beta-12B marcado como revertido).
