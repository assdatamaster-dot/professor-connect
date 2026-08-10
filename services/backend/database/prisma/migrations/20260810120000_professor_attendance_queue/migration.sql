-- The queue reuses RequestStatus.PENDING. No enum values are introduced here.
ALTER TABLE "session_requests"
  ADD COLUMN "queued_at" TIMESTAMPTZ(3);

CREATE INDEX "session_requests_professor_id_status_created_at_id_idx"
  ON "session_requests"("professor_id", "status", "created_at", "id");

-- A student can wait for only one professor at a time.
CREATE UNIQUE INDEX "session_requests_one_pending_per_student_idx"
  ON "session_requests"("student_id")
  WHERE "status" = 'PENDING'::"RequestStatus";

-- Database-level protection complements the synchronous manager guard.
CREATE UNIQUE INDEX "attendance_sessions_one_active_per_professor_idx"
  ON "attendance_sessions"("professor_id")
  WHERE "status" NOT IN (
    'FINISHED'::"AttendanceSessionStatus",
    'INTERRUPTED'::"AttendanceSessionStatus"
  );
