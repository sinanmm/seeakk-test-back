-- CreateTable
CREATE TABLE "target_cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "target_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_cycle_ranges" (
    "id" TEXT NOT NULL,
    "targetCycleId" TEXT NOT NULL,
    "startDay" INTEGER NOT NULL,
    "endDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_cycle_ranges_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "target_settings"
ADD COLUMN IF NOT EXISTS "targetCycleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "target_cycles_name_workspaceId_key" ON "target_cycles"("name", "workspaceId");

-- CreateIndex
CREATE INDEX "target_cycles_workspaceId_idx" ON "target_cycles"("workspaceId");

-- CreateIndex
CREATE INDEX "target_cycle_ranges_targetCycleId_idx" ON "target_cycle_ranges"("targetCycleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "target_settings_targetCycleId_idx" ON "target_settings"("targetCycleId");

-- AddForeignKey
ALTER TABLE "target_cycles" ADD CONSTRAINT "target_cycles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_cycle_ranges" ADD CONSTRAINT "target_cycle_ranges_targetCycleId_fkey" FOREIGN KEY ("targetCycleId") REFERENCES "target_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_settings" ADD CONSTRAINT "target_settings_targetCycleId_fkey" FOREIGN KEY ("targetCycleId") REFERENCES "target_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
