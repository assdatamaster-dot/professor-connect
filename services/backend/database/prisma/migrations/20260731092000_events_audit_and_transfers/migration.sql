CREATE TYPE "FileTransferStatus" AS ENUM ('REQUESTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'FAILED');
CREATE TYPE "FileTransferDirection" AS ENUM ('TEACHER_TO_STUDENT', 'STUDENT_TO_TEACHER');
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

CREATE TABLE "file_transfers" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "direction" "FileTransferDirection" NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "byte_size" BIGINT NOT NULL,
  "checksum" TEXT,
  "status" "FileTransferStatus" NOT NULL,
  "failure_reason" TEXT,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "file_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_transfers_byte_size_check" CHECK ("byte_size" >= 0)
);
CREATE INDEX "file_transfers_session_id_started_at_idx" ON "file_transfers"("session_id", "started_at");
CREATE INDEX "file_transfers_status_started_at_idx" ON "file_transfers"("status", "started_at");

CREATE TABLE "domain_events" (
  "id" BIGSERIAL NOT NULL,
  "request_id" UUID,
  "session_id" UUID,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "domain_events_type_occurred_at_idx" ON "domain_events"("type", "occurred_at");
CREATE INDEX "domain_events_session_id_occurred_at_idx" ON "domain_events"("session_id", "occurred_at");

CREATE TABLE "audit_logs" (
  "id" BIGSERIAL NOT NULL,
  "actor_type" TEXT,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_action_occurred_at_idx" ON "audit_logs"("action", "occurred_at");
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at");

CREATE TABLE "application_logs" (
  "id" BIGSERIAL NOT NULL,
  "level" "AuditSeverity" NOT NULL,
  "origin" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "context" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "application_logs_level_occurred_at_idx" ON "application_logs"("level", "occurred_at");
CREATE INDEX "application_logs_event_occurred_at_idx" ON "application_logs"("event", "occurred_at");

ALTER TABLE "file_transfers" ADD CONSTRAINT "file_transfers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "session_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
