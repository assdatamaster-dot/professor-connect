ALTER TABLE "organizations"
  ADD COLUMN "trade_name" TEXT,
  ADD COLUMN "tax_id" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "country" TEXT NOT NULL DEFAULT 'BR',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'pt-BR';

CREATE UNIQUE INDEX "organizations_tax_id_key" ON "organizations"("tax_id");

ALTER TABLE "users"
  ADD COLUMN "first_name" TEXT,
  ADD COLUMN "last_name" TEXT,
  ADD COLUMN "phone" TEXT;

CREATE TABLE "system_settings" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "system_name" TEXT NOT NULL,
  "logo_mime_type" TEXT,
  "logo_bytes" BYTEA,
  "theme" TEXT NOT NULL DEFAULT 'system',
  "language" TEXT NOT NULL DEFAULT 'pt-BR',
  "defaults" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_settings_organization_id_key"
  ON "system_settings"("organization_id");

ALTER TABLE "system_settings"
  ADD CONSTRAINT "system_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bootstrap_state" (
  "id" INTEGER NOT NULL,
  "initialized_at" TIMESTAMPTZ(3),
  "organization_id" UUID,
  "administrator_id" UUID,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "bootstrap_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bootstrap_state_singleton" CHECK ("id" = 1)
);

INSERT INTO "bootstrap_state" (
  "id",
  "initialized_at",
  "organization_id",
  "administrator_id",
  "updated_at"
)
VALUES (
  1,
  CASE WHEN EXISTS (
    SELECT 1
    FROM "users" u
    INNER JOIN "user_roles" ur ON ur."user_id" = u."id"
    INNER JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."name" = 'ADMIN' AND u."deleted_at" IS NULL
  ) THEN CURRENT_TIMESTAMP ELSE NULL END,
  (
    SELECT u."organization_id"
    FROM "users" u
    INNER JOIN "user_roles" ur ON ur."user_id" = u."id"
    INNER JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."name" = 'ADMIN' AND u."deleted_at" IS NULL
    ORDER BY u."created_at"
    LIMIT 1
  ),
  (
    SELECT u."id"
    FROM "users" u
    INNER JOIN "user_roles" ur ON ur."user_id" = u."id"
    INNER JOIN "roles" r ON r."id" = ur."role_id"
    WHERE r."name" = 'ADMIN' AND u."deleted_at" IS NULL
    ORDER BY u."created_at"
    LIMIT 1
  ),
  CURRENT_TIMESTAMP
);
