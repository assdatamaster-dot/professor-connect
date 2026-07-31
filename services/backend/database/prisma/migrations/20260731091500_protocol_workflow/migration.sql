CREATE TYPE "WorkflowSessionStatus" AS ENUM ('WAITING', 'ACTIVE', 'FINISHED');
CREATE TYPE "SupportCallStatus" AS ENUM ('CREATED', 'CONNECTING', 'CONNECTED', 'FINISHED', 'FAILED', 'CANCELLED');

CREATE TABLE "session_request_recipients" (
  "request_id" UUID NOT NULL,
  "professor_id" TEXT NOT NULL,
  "rejected_at" TIMESTAMPTZ(3),
  CONSTRAINT "session_request_recipients_pkey" PRIMARY KEY ("request_id", "professor_id")
);
CREATE INDEX "session_request_recipients_professor_id_rejected_at_idx" ON "session_request_recipients"("professor_id", "rejected_at");

CREATE TABLE "workflow_sessions" (
  "id" UUID NOT NULL,
  "status" "WorkflowSessionStatus" NOT NULL DEFAULT 'WAITING',
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "workflow_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "workflow_sessions_status_updated_at_idx" ON "workflow_sessions"("status", "updated_at");

CREATE TABLE "workflow_session_participants" (
  "id" BIGSERIAL NOT NULL,
  "session_id" UUID NOT NULL,
  "client_id" TEXT NOT NULL,
  "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_session_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "workflow_session_participants_session_id_client_id_key" ON "workflow_session_participants"("session_id", "client_id");
CREATE INDEX "workflow_session_participants_client_id_idx" ON "workflow_session_participants"("client_id");

CREATE TABLE "support_calls" (
  "id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "session_id" UUID,
  "student_id" TEXT NOT NULL,
  "professor_id" TEXT NOT NULL,
  "status" "SupportCallStatus" NOT NULL DEFAULT 'CREATED',
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "connected_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "support_calls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "support_calls_request_id_key" ON "support_calls"("request_id");
CREATE INDEX "support_calls_status_created_at_idx" ON "support_calls"("status", "created_at");
CREATE INDEX "support_calls_student_id_created_at_idx" ON "support_calls"("student_id", "created_at");
CREATE INDEX "support_calls_professor_id_created_at_idx" ON "support_calls"("professor_id", "created_at");

ALTER TABLE "session_request_recipients" ADD CONSTRAINT "session_request_recipients_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "session_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_request_recipients" ADD CONSTRAINT "session_request_recipients_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "professors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_session_participants" ADD CONSTRAINT "workflow_session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "workflow_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_calls" ADD CONSTRAINT "support_calls_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "session_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
