-- Older releases created technical organizations during migrations/seeding. They prevent the
-- first-run wizard when both artifacts coexist, even though no administrator was ever created.
-- Remove only the known slugs and only while they are completely unreferenced.
DELETE FROM "organizations" AS organization
WHERE organization."slug" IN ('legacy', 'professor-connect')
  AND NOT EXISTS (
    SELECT 1 FROM "users" AS app_user
    WHERE app_user."organization_id" = organization."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "professors" AS professor
    WHERE professor."organization_id" = organization."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "students" AS student
    WHERE student."organization_id" = organization."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "system_settings" AS settings
    WHERE settings."organization_id" = organization."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "bootstrap_state" AS state
    WHERE state."organization_id" = organization."id"
  );
