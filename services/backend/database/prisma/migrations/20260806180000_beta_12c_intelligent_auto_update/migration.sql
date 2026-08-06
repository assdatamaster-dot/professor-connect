CREATE TYPE "UpdateApplication" AS ENUM ('TEACHER', 'STUDENT');
CREATE TYPE "UpdateChannel" AS ENUM ('STABLE', 'BETA', 'DEVELOPMENT');

CREATE TABLE "update_releases" (
  "id" UUID NOT NULL,
  "application" "UpdateApplication" NOT NULL,
  "version" TEXT NOT NULL,
  "channel" "UpdateChannel" NOT NULL,
  "release_notes" JSONB NOT NULL DEFAULT '{}',
  "download_url" TEXT NOT NULL,
  "sha512" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "signature" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "update_releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "update_installations" (
  "id" UUID NOT NULL,
  "client_id" UUID NOT NULL,
  "application" "UpdateApplication" NOT NULL,
  "channel" "UpdateChannel" NOT NULL,
  "current_version" TEXT NOT NULL,
  "previous_version" TEXT,
  "user_id" UUID,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "update_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "update_audit_events" (
  "id" BIGSERIAL NOT NULL,
  "client_id" UUID NOT NULL,
  "application" "UpdateApplication" NOT NULL,
  "channel" "UpdateChannel" NOT NULL,
  "event" TEXT NOT NULL,
  "previous_version" TEXT,
  "new_version" TEXT,
  "duration_milliseconds" INTEGER,
  "error" TEXT,
  "user_id" UUID,
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "update_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "update_releases_application_channel_version_key" ON "update_releases"("application", "channel", "version");
CREATE INDEX "update_releases_application_channel_published_published_at_idx" ON "update_releases"("application", "channel", "published", "published_at");
CREATE UNIQUE INDEX "update_installations_client_id_application_key" ON "update_installations"("client_id", "application");
CREATE INDEX "update_installations_application_channel_current_version_idx" ON "update_installations"("application", "channel", "current_version");
CREATE INDEX "update_installations_last_seen_at_idx" ON "update_installations"("last_seen_at");
CREATE INDEX "update_audit_events_client_id_occurred_at_idx" ON "update_audit_events"("client_id", "occurred_at");
CREATE INDEX "update_audit_events_application_channel_event_occurred_at_idx" ON "update_audit_events"("application", "channel", "event", "occurred_at");
