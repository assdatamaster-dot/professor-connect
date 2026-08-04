ALTER TABLE "users"
  ADD COLUMN "avatar_url" TEXT,
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3);

-- A organização pública mantém os cadastros autônomos no mesmo espaço de presença.
INSERT INTO "organizations" ("id", "name", "slug", "created_at", "updated_at")
VALUES (
  '00000000-0000-4000-8000-000000000011',
  'Professor Connect',
  'professor-connect',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO UPDATE SET "name" = EXCLUDED."name", "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "roles" ("id", "name", "description") VALUES
  ('00000000-0000-4000-8000-000000000101', 'ADMIN', 'Perfil administrador'),
  ('00000000-0000-4000-8000-000000000102', 'TEACHER', 'Perfil professor'),
  ('00000000-0000-4000-8000-000000000103', 'STUDENT', 'Perfil aluno')
ON CONFLICT ("name") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "permissions" ("id", "code", "description") VALUES
  ('00000000-0000-4000-8000-000000000201', 'socket.connect', 'Conectar ao serviço em tempo real'),
  ('00000000-0000-4000-8000-000000000202', 'professors.online.read', 'Visualizar professores online'),
  ('00000000-0000-4000-8000-000000000203', 'students.online.read', 'Visualizar alunos online'),
  ('00000000-0000-4000-8000-000000000204', 'sessions.read', 'Visualizar sessões'),
  ('00000000-0000-4000-8000-000000000205', 'session.request', 'Solicitar atendimento'),
  ('00000000-0000-4000-8000-000000000206', 'session.respond', 'Responder solicitação'),
  ('00000000-0000-4000-8000-000000000207', 'webrtc.use', 'Usar comunicação WebRTC'),
  ('00000000-0000-4000-8000-000000000208', 'remote-control.request', 'Solicitar controle remoto'),
  ('00000000-0000-4000-8000-000000000209', 'remote-control.approve', 'Autorizar controle remoto'),
  ('00000000-0000-4000-8000-000000000210', 'files.transfer', 'Transferir arquivos'),
  ('00000000-0000-4000-8000-000000000211', 'users.manage', 'Gerenciar usuários'),
  ('00000000-0000-4000-8000-000000000212', 'audit.read', 'Visualizar auditoria')
ON CONFLICT ("code") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
JOIN "permissions" permission ON (
  (role."name" = 'ADMIN')
  OR (role."name" = 'TEACHER' AND permission."code" IN (
    'socket.connect', 'students.online.read', 'sessions.read', 'session.respond',
    'webrtc.use', 'remote-control.request', 'files.transfer'
  ))
  OR (role."name" = 'STUDENT' AND permission."code" IN (
    'socket.connect', 'professors.online.read', 'sessions.read', 'session.request',
    'webrtc.use', 'remote-control.approve', 'files.transfer'
  ))
)
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- O índice funcional torna a unicidade de e-mail independente de caixa no PostgreSQL.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (LOWER("email"));
