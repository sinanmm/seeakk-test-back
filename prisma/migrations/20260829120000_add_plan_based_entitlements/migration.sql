-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "activePlanId" TEXT;

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN "requestedPlanId" TEXT,
ADD COLUMN "planCodeSnapshot" TEXT,
ADD COLUMN "planNameSnapshot" TEXT;

-- AlterTable
ALTER TABLE "verified_payments" ADD COLUMN "planId" TEXT,
ADD COLUMN "planCodeSnapshot" TEXT,
ADD COLUMN "planNameSnapshot" TEXT;

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePerUserMonth" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_modules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_modules" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "app_modules_key_key" ON "app_modules"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_modules_planId_moduleId_key" ON "plan_modules"("planId", "moduleId");

-- CreateIndex
CREATE INDEX "plan_modules_planId_idx" ON "plan_modules"("planId");

-- CreateIndex
CREATE INDEX "plan_modules_moduleId_idx" ON "plan_modules"("moduleId");

-- CreateIndex
CREATE INDEX "workspaces_activePlanId_idx" ON "workspaces"("activePlanId");

-- CreateIndex
CREATE INDEX "payment_requests_requestedPlanId_idx" ON "payment_requests"("requestedPlanId");

-- CreateIndex
CREATE INDEX "verified_payments_planId_idx" ON "verified_payments"("planId");

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_activePlanId_fkey" FOREIGN KEY ("activePlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requestedPlanId_fkey" FOREIGN KEY ("requestedPlanId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verified_payments" ADD CONSTRAINT "verified_payments_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "app_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
