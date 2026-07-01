ALTER TABLE "lead_sources" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "lead_stages" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
ALTER TABLE "stage_rules" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

UPDATE "lead_sources" AS ls
SET "workspaceId" = u."workspaceId"
FROM "users" AS u
WHERE ls."createdBy" = u."id"
  AND ls."workspaceId" IS NULL;

UPDATE "lead_stages" AS ls
SET "workspaceId" = u."workspaceId"
FROM "users" AS u
WHERE ls."createdBy" = u."id"
  AND ls."workspaceId" IS NULL;

UPDATE "stage_rules" AS sr
SET "workspaceId" = u."workspaceId"
FROM "users" AS u
WHERE sr."createdBy" = u."id"
  AND sr."workspaceId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'lead_sources'
      AND constraint_name = 'lead_sources_name_key'
  ) THEN
    ALTER TABLE "lead_sources" DROP CONSTRAINT "lead_sources_name_key";
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "lead_sources_workspaceId_idx" ON "lead_sources"("workspaceId");
CREATE INDEX IF NOT EXISTS "lead_sources_workspaceId_status_createdAt_idx"
  ON "lead_sources"("workspaceId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "lead_stages_workspaceId_idx" ON "lead_stages"("workspaceId");
CREATE INDEX IF NOT EXISTS "lead_stages_workspaceId_status_order_idx"
  ON "lead_stages"("workspaceId", "status", "order");
CREATE INDEX IF NOT EXISTS "stage_rules_workspaceId_idx" ON "stage_rules"("workspaceId");
CREATE INDEX IF NOT EXISTS "stage_rules_workspaceId_status_sortOrder_idx"
  ON "stage_rules"("workspaceId", "status", "sortOrder");

CREATE UNIQUE INDEX IF NOT EXISTS "lead_sources_workspace_name_active_key"
  ON "lead_sources"("workspaceId", LOWER("name"))
  WHERE "deletedAt" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'lead_sources'
      AND constraint_name = 'lead_sources_workspaceId_fkey'
  ) THEN
    ALTER TABLE "lead_sources"
      ADD CONSTRAINT "lead_sources_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'lead_stages'
      AND constraint_name = 'lead_stages_workspaceId_fkey'
  ) THEN
    ALTER TABLE "lead_stages"
      ADD CONSTRAINT "lead_stages_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'stage_rules'
      AND constraint_name = 'stage_rules_workspaceId_fkey'
  ) THEN
    ALTER TABLE "stage_rules"
      ADD CONSTRAINT "stage_rules_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
