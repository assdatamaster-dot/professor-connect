ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMPTZ(3);

INSERT INTO "organizations" ("id", "name", "slug", "created_at", "updated_at")
VALUES ('00000000-0000-4000-8000-000000000001', 'Instituição legado', 'legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;
UPDATE "users"
SET "organization_id" = (SELECT "id" FROM "organizations" WHERE "slug" = 'legacy')
WHERE "organization_id" IS NULL;
ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "auth_tokens"
  ADD COLUMN "family_id" UUID,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "ip_address" TEXT,
  ADD COLUMN "last_used_at" TIMESTAMPTZ(3);
UPDATE "auth_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "auth_tokens" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "auth_tokens_family_id_idx" ON "auth_tokens"("family_id");

CREATE TABLE "external_identities" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_identities_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "external_identities_provider_provider_user_id_key"
  ON "external_identities"("provider", "provider_user_id");
CREATE INDEX "external_identities_user_id_idx" ON "external_identities"("user_id");
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
