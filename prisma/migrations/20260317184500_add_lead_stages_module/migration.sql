-- CreateEnum
CREATE TYPE "LeadStageStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "lead_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#10b981',
    "isApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "isLOB" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "stageOrder" INTEGER NOT NULL,
    "rules" JSONB,
    "status" "LeadStageStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_stages_name_key" ON "lead_stages"("name");

-- CreateIndex
CREATE INDEX "lead_stages_name_idx" ON "lead_stages"("name");

-- CreateIndex
CREATE INDEX "lead_stages_status_idx" ON "lead_stages"("status");

-- CreateIndex
CREATE INDEX "lead_stages_stageOrder_idx" ON "lead_stages"("stageOrder");

