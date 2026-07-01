-- Mark target lock audit rows that were applied to the wrong account (assigner/creator vs assignee).
ALTER TABLE "target_lock_logs"
  ADD COLUMN IF NOT EXISTS "isInvalidLock" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "invalidatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "target_lock_logs_isInvalidLock_idx" ON "target_lock_logs"("isInvalidLock");
