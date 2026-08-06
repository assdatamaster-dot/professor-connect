ALTER TABLE "file_transfers"
  ADD COLUMN "average_bytes_per_second" BIGINT,
  ADD COLUMN "duration_milliseconds" BIGINT;

ALTER TABLE "file_transfers"
  ADD CONSTRAINT "file_transfers_average_speed_check"
    CHECK ("average_bytes_per_second" IS NULL OR "average_bytes_per_second" >= 0),
  ADD CONSTRAINT "file_transfers_duration_check"
    CHECK ("duration_milliseconds" IS NULL OR "duration_milliseconds" >= 0);
