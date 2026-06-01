-- Target lock exemption + audit fields (post-unlock period protection)
ALTER TABLE "target_assignments"
  ADD COLUMN IF NOT EXISTS "isLockExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "exemptUntilPeriodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "exemptPeriodId" TEXT,
  ADD COLUMN IF NOT EXISTS "lastUnlockDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastUnlockedBy" TEXT;

CREATE INDEX IF NOT EXISTS "target_assignments_exemptPeriodId_idx" ON "target_assignments"("exemptPeriodId");

ALTER TABLE "target_lock_logs"
  ADD COLUMN IF NOT EXISTS "lockPeriodId" TEXT;

CREATE INDEX IF NOT EXISTS "target_lock_logs_lockPeriodId_idx" ON "target_lock_logs"("lockPeriodId");

ALTER TABLE "target_unlock_logs"
  ADD COLUMN IF NOT EXISTS "exemptPeriodId" TEXT,
  ADD COLUMN IF NOT EXISTS "exemptUntilPeriodEnd" TIMESTAMP(3);
