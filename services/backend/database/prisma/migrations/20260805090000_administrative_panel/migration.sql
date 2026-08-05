-- Estados administrativos definitivos. Valores antigos são convertidos sem perda de usuários.
ALTER TYPE "UserStatus" RENAME TO "UserStatus_legacy";
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users"
  ALTER COLUMN "status" TYPE "UserStatus"
  USING (
    CASE "status"::TEXT
      WHEN 'ACTIVE' THEN 'ACTIVE'
      WHEN 'SUSPENDED' THEN 'BLOCKED'
      ELSE 'INACTIVE'
    END
  )::"UserStatus";
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
DROP TYPE "UserStatus_legacy";

ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- E-mails são únicos dentro da instituição, permitindo expansão multi-tenant.
DROP INDEX IF EXISTS "users_email_key";
DROP INDEX IF EXISTS "users_email_lower_key";
CREATE UNIQUE INDEX "users_organization_email_lower_key"
  ON "users" ("organization_id", LOWER("email"));

DROP INDEX IF EXISTS "users_organization_id_idx";
CREATE INDEX "users_organization_id_status_created_at_idx"
  ON "users" ("organization_id", "status", "created_at");
CREATE INDEX "users_organization_id_deleted_at_idx"
  ON "users" ("organization_id", "deleted_at");

CREATE TABLE "user_avatars" (
  "user_id" UUID NOT NULL,
  "mime_type" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_avatars_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "user_avatars"
  ADD CONSTRAINT "user_avatars_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
