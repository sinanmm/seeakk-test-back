-- Rename stage status enum to align with schema naming
ALTER TYPE "LeadStageStatus" RENAME TO "StageStatus";

-- Align lead_stages table structure
DROP INDEX IF EXISTS "lead_stages_name_key";
ALTER TABLE "lead_stages" RENAME COLUMN "stageOrder" TO "order";
ALTER TABLE "lead_stages" DROP COLUMN IF EXISTS "rules";
ALTER INDEX IF EXISTS "lead_stages_stageOrder_idx" RENAME TO "lead_stages_order_idx";

-- Stage rules table
CREATE TABLE "stage_rules" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "value" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "stage_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stage_rules_stageId_idx" ON "stage_rules"("stageId");

ALTER TABLE "stage_rules"
ADD CONSTRAINT "stage_rules_stageId_fkey"
FOREIGN KEY ("stageId") REFERENCES "lead_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
