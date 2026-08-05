CREATE TYPE "ProfessorAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'BUSY');

ALTER TABLE "professors"
ADD COLUMN "availability" "ProfessorAvailability" NOT NULL DEFAULT 'UNAVAILABLE',
ADD COLUMN "available_since" TIMESTAMPTZ(3);

CREATE INDEX "professors_organization_id_availability_available_since_idx"
ON "professors"("organization_id", "availability", "available_since");
