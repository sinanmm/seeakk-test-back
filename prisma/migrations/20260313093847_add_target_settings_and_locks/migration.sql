-- CreateEnum
CREATE TYPE "TargetCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ViolationType" AS ENUM ('DAILY', 'MONTHLY');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "target_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetTypeId" TEXT NOT NULL,
    "cycle" "TargetCycle" NOT NULL DEFAULT 'MONTHLY',
    "monthlyTargetLeads" INTEGER NOT NULL DEFAULT 0,
    "dailyFollowupTarget" INTEGER NOT NULL DEFAULT 0,
    "revenueTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_violations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "ViolationType" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'WARNING',
    "message" TEXT,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "target_violations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "target_types_name_key" ON "target_types"("name");

-- CreateIndex
CREATE INDEX "target_settings_userId_workspaceId_idx" ON "target_settings"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "target_violations_userId_date_idx" ON "target_violations"("userId", "date");

-- AddForeignKey
ALTER TABLE "target_settings" ADD CONSTRAINT "target_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_settings" ADD CONSTRAINT "target_settings_targetTypeId_fkey" FOREIGN KEY ("targetTypeId") REFERENCES "target_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_violations" ADD CONSTRAINT "target_violations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
