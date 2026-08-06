ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'CONNECTING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'RECONNECTING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'RECOVERING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'DISCONNECTED';

ALTER TABLE "attendance_sessions"
  ADD COLUMN "state_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "recovery_deadline" TIMESTAMPTZ(3),
  ADD COLUMN "teacher_recovery_token_hash" TEXT,
  ADD COLUMN "student_recovery_token_hash" TEXT,
  ADD COLUMN "last_heartbeat_at" TIMESTAMPTZ(3),
  ADD COLUMN "connected_milliseconds" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "reconnecting_milliseconds" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "disconnect_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "attendance_sessions" ALTER COLUMN "status" DROP DEFAULT;
UPDATE "attendance_sessions"
SET "status" = 'CONNECTED'::"AttendanceSessionStatus"
WHERE "status" = 'ACTIVE'::"AttendanceSessionStatus";
ALTER TABLE "attendance_sessions" ALTER COLUMN "status" SET DEFAULT 'CONNECTED';

CREATE INDEX "attendance_sessions_status_recovery_deadline_idx"
  ON "attendance_sessions"("status", "recovery_deadline");

INSERT INTO "audit_logs" ("action", "entity_type", "severity", "metadata")
VALUES (
  'migration.beta-12b-session-recovery',
  'database',
  'INFO',
  jsonb_build_object('plaintextRecoveryTokensPersisted', false)
);
