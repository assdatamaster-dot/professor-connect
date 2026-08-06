-- PostgreSQL does not allow a value added to an existing enum to be used
-- before the transaction that added it has committed. Prisma 6.19 executes a
-- PostgreSQL migration file as one simple-query batch, so these values must be
-- committed in a migration before Beta-12B updates rows to CONNECTED.
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'WAITING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'CONNECTING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'CONNECTED';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'RECONNECTING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'RECOVERING';
ALTER TYPE "AttendanceSessionStatus" ADD VALUE IF NOT EXISTS 'DISCONNECTED';
