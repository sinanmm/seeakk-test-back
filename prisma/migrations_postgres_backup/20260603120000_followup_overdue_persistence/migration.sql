ALTER TABLE "follow_ups"
ADD COLUMN IF NOT EXISTS "isOverdue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "overdueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "completedAfterOverdue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "extendedAfterOverdue" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "follow_ups_workspace_overdue_idx"
ON "follow_ups" ("workspaceId", "isOverdue", "scheduledAt");
