DO $$
BEGIN
  CREATE TYPE "InputType" AS ENUM ('TEXT', 'TEXTAREA', 'RADIO', 'SELECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "stage_rules"
  ALTER COLUMN "stageId" DROP NOT NULL;

ALTER TABLE "stage_rules"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "inputType" "InputType",
  ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER,
  ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "stageId" ORDER BY "id") AS row_num
  FROM "stage_rules"
)
UPDATE "stage_rules" AS sr
SET
  "name" = COALESCE(NULLIF(TRIM(sr."field"), ''), CONCAT('Rule ', ranked.row_num::text)),
  "inputType" = COALESCE(sr."inputType", 'TEXT'::"InputType"),
  "sortOrder" = COALESCE(sr."sortOrder", ranked.row_num),
  "required" = COALESCE(sr."required", sr."isMandatory", false),
  "status" = COALESCE(sr."status", 'ACTIVE'::"RuleStatus")
FROM ranked
WHERE sr."id" = ranked."id";

ALTER TABLE "stage_rules"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "inputType" SET NOT NULL,
  ALTER COLUMN "sortOrder" SET NOT NULL;

ALTER TABLE "stage_rules" DROP CONSTRAINT IF EXISTS "stage_rules_stageId_fkey";
ALTER TABLE "stage_rules"
  ADD CONSTRAINT "stage_rules_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stage_rules"
  DROP COLUMN IF EXISTS "field",
  DROP COLUMN IF EXISTS "condition",
  DROP COLUMN IF EXISTS "value",
  DROP COLUMN IF EXISTS "isMandatory";

CREATE INDEX IF NOT EXISTS "stage_rules_name_idx" ON "stage_rules"("name");
CREATE INDEX IF NOT EXISTS "stage_rules_status_idx" ON "stage_rules"("status");
CREATE INDEX IF NOT EXISTS "stage_rules_sortOrder_idx" ON "stage_rules"("sortOrder");
CREATE INDEX IF NOT EXISTS "stage_rules_stageId_idx" ON "stage_rules"("stageId");

CREATE TABLE IF NOT EXISTS "lead_stage_inputs" (
  "id" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_stage_inputs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_stage_inputs_leadId_idx" ON "lead_stage_inputs"("leadId");
CREATE INDEX IF NOT EXISTS "lead_stage_inputs_ruleId_idx" ON "lead_stage_inputs"("ruleId");

ALTER TABLE "lead_stage_inputs" DROP CONSTRAINT IF EXISTS "lead_stage_inputs_ruleId_fkey";
ALTER TABLE "lead_stage_inputs"
  ADD CONSTRAINT "lead_stage_inputs_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "stage_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
