-- CreateTable
CREATE TABLE "lead_life_cycles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_life_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_life_cycle_transitions" (
    "id" TEXT NOT NULL,
    "lifecycleId" TEXT NOT NULL,
    "fromStageId" TEXT NOT NULL,
    "toStageId" TEXT NOT NULL,
    "numberOfDays" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_life_cycle_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_life_cycles_name_workspaceId_key" ON "lead_life_cycles"("name", "workspaceId");

-- CreateIndex
CREATE INDEX "lead_life_cycles_workspaceId_idx" ON "lead_life_cycles"("workspaceId");

-- CreateIndex
CREATE INDEX "lead_life_cycle_transitions_lifecycleId_idx" ON "lead_life_cycle_transitions"("lifecycleId");

-- CreateIndex
CREATE INDEX "lead_life_cycle_transitions_workspaceId_idx" ON "lead_life_cycle_transitions"("workspaceId");

-- AddForeignKey
ALTER TABLE "lead_life_cycles" ADD CONSTRAINT "lead_life_cycles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_life_cycle_transitions" ADD CONSTRAINT "lead_life_cycle_transitions_lifecycleId_fkey" FOREIGN KEY ("lifecycleId") REFERENCES "lead_life_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
