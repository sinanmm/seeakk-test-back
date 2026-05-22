-- Target Cycle performance & locking engine
CREATE TYPE "TargetCycleType" AS ENUM ('WEEKLY', 'MONTHLY', 'SEMI_ANNUAL', 'MANUAL');
CREATE TYPE "TargetMetricType" AS ENUM ('LEADS', 'REVENUE');

ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "targetType" "TargetCycleType" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "targetMetric" "TargetMetricType" NOT NULL DEFAULT 'LEADS';
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "leadStageId" TEXT;
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "numberOfMonths" INTEGER;
ALTER TABLE "target_cycles" ADD COLUMN IF NOT EXISTS "lockingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "target_cycles" ALTER COLUMN "totalDays" SET DEFAULT 30;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_cycles_leadStageId_fkey') THEN
    ALTER TABLE "target_cycles"
      ADD CONSTRAINT "target_cycles_leadStageId_fkey"
      FOREIGN KEY ("leadStageId") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "target_cycle_periods" (
  "id" TEXT NOT NULL,
  "targetCycleId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "periodIndex" INTEGER NOT NULL,
  "targetCount" INTEGER NOT NULL DEFAULT 0,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "lockingDate" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "target_cycle_periods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "target_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetCycleId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "supervisorId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedById" TEXT,
  "graceUntil" TIMESTAMP(3),
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "target_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "target_performance_logs" (
  "id" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "targetCount" INTEGER NOT NULL,
  "achievedCount" INTEGER NOT NULL DEFAULT 0,
  "achievedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "completionPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "evaluatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "target_performance_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "target_lock_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "periodId" TEXT,
  "reason" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedBySystem" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "target_lock_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "target_unlock_logs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "unlockedById" TEXT NOT NULL,
  "reason" TEXT,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "target_unlock_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "assignedTargetCycleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "targetLockedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "targetLockReason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "target_assignments_userId_targetCycleId_key" ON "target_assignments"("userId", "targetCycleId");
CREATE UNIQUE INDEX IF NOT EXISTS "target_performance_logs_assignmentId_periodId_key" ON "target_performance_logs"("assignmentId", "periodId");
CREATE INDEX IF NOT EXISTS "target_cycle_periods_targetCycleId_idx" ON "target_cycle_periods"("targetCycleId");
CREATE INDEX IF NOT EXISTS "target_cycle_periods_lockingDate_idx" ON "target_cycle_periods"("lockingDate");
CREATE INDEX IF NOT EXISTS "target_assignments_workspaceId_isActive_idx" ON "target_assignments"("workspaceId", "isActive");
CREATE INDEX IF NOT EXISTS "target_lock_logs_userId_lockedAt_idx" ON "target_lock_logs"("userId", "lockedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_cycle_periods_targetCycleId_fkey') THEN
    ALTER TABLE "target_cycle_periods" ADD CONSTRAINT "target_cycle_periods_targetCycleId_fkey"
      FOREIGN KEY ("targetCycleId") REFERENCES "target_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_assignments_userId_fkey') THEN
    ALTER TABLE "target_assignments" ADD CONSTRAINT "target_assignments_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_assignments_targetCycleId_fkey') THEN
    ALTER TABLE "target_assignments" ADD CONSTRAINT "target_assignments_targetCycleId_fkey"
      FOREIGN KEY ("targetCycleId") REFERENCES "target_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_performance_logs_assignmentId_fkey') THEN
    ALTER TABLE "target_performance_logs" ADD CONSTRAINT "target_performance_logs_assignmentId_fkey"
      FOREIGN KEY ("assignmentId") REFERENCES "target_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'target_performance_logs_periodId_fkey') THEN
    ALTER TABLE "target_performance_logs" ADD CONSTRAINT "target_performance_logs_periodId_fkey"
      FOREIGN KEY ("periodId") REFERENCES "target_cycle_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_assignedTargetCycleId_fkey') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_assignedTargetCycleId_fkey"
      FOREIGN KEY ("assignedTargetCycleId") REFERENCES "target_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
