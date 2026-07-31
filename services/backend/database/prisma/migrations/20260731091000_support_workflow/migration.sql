CREATE TYPE "PresenceRole" AS ENUM ('TEACHER', 'STUDENT');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "AttendanceSessionStatus" AS ENUM ('ACTIVE', 'FINISHED', 'INTERRUPTED');

CREATE TABLE "presence_connections" (
  "id" UUID NOT NULL,
  "professor_id" TEXT,
  "student_id" TEXT,
  "role" "PresenceRole" NOT NULL,
  "socket_id" TEXT NOT NULL,
  "connected_at" TIMESTAMPTZ(3) NOT NULL,
  "last_heartbeat" TIMESTAMPTZ(3) NOT NULL,
  "disconnected_at" TIMESTAMPTZ(3),
  "is_online" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "presence_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "presence_connections_participant_check" CHECK (
    ("role" = 'TEACHER' AND "professor_id" IS NOT NULL AND "student_id" IS NULL) OR
    ("role" = 'STUDENT' AND "student_id" IS NOT NULL AND "professor_id" IS NULL)
  )
);
CREATE INDEX "presence_connections_is_online_role_idx" ON "presence_connections"("is_online", "role");
CREATE INDEX "presence_connections_professor_id_connected_at_idx" ON "presence_connections"("professor_id", "connected_at");
CREATE INDEX "presence_connections_student_id_connected_at_idx" ON "presence_connections"("student_id", "connected_at");
CREATE UNIQUE INDEX "presence_connections_socket_id_connected_at_key" ON "presence_connections"("socket_id", "connected_at");

CREATE TABLE "session_requests" (
  "id" UUID NOT NULL,
  "professor_id" TEXT,
  "student_id" TEXT NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "responded_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  CONSTRAINT "session_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "session_requests_status_created_at_idx" ON "session_requests"("status", "created_at");
CREATE INDEX "session_requests_professor_id_status_idx" ON "session_requests"("professor_id", "status");
CREATE INDEX "session_requests_student_id_created_at_idx" ON "session_requests"("student_id", "created_at");

CREATE TABLE "attendance_sessions" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "professor_id" TEXT NOT NULL,
  "student_id" TEXT NOT NULL,
  "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "ended_at" TIMESTAMPTZ(3),
  "duration_seconds" INTEGER,
  "end_reason" TEXT,
  "used_screen_share" BOOLEAN NOT NULL DEFAULT false,
  "used_remote_control" BOOLEAN NOT NULL DEFAULT false,
  "used_file_transfer" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_sessions_duration_check" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0)
);
CREATE UNIQUE INDEX "attendance_sessions_request_id_key" ON "attendance_sessions"("request_id");
CREATE INDEX "attendance_sessions_status_started_at_idx" ON "attendance_sessions"("status", "started_at");
CREATE INDEX "attendance_sessions_professor_id_started_at_idx" ON "attendance_sessions"("professor_id", "started_at");
CREATE INDEX "attendance_sessions_student_id_started_at_idx" ON "attendance_sessions"("student_id", "started_at");

ALTER TABLE "presence_connections" ADD CONSTRAINT "presence_connections_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "presence_connections" ADD CONSTRAINT "presence_connections_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "session_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
