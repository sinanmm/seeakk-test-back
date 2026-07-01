-- LOB analytics: persist pipeline stage immediately before each LOB log row.
-- Required by Prisma model LeadLOBLog (previousStageId / previousStageName).

ALTER TABLE "lead_lob_logs" ADD COLUMN IF NOT EXISTS "previousStageId" TEXT;
ALTER TABLE "lead_lob_logs" ADD COLUMN IF NOT EXISTS "previousStageName" TEXT;

CREATE INDEX IF NOT EXISTS "lead_lob_logs_previousStageId_idx"
ON "lead_lob_logs"("previousStageId");

CREATE INDEX IF NOT EXISTS "lead_lob_logs_workspaceId_previousStageId_idx"
ON "lead_lob_logs"("workspaceId", "previousStageId");
