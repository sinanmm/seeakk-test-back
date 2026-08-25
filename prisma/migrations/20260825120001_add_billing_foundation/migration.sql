-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "accessFrom" TIMESTAMP(3),
ADD COLUMN     "accessUntil" TIMESTAMP(3),
ADD COLUMN     "approvedUserLimit" INTEGER,
ADD COLUMN     "billingStatus" TEXT,
ADD COLUMN     "lockReason" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "platform_billing_settings" (
    "id" TEXT NOT NULL,
    "pricePerUserPerMonth" INTEGER NOT NULL DEFAULT 499,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "upiId" TEXT NOT NULL DEFAULT 'yourupi@bank',
    "upiPayeeName" TEXT NOT NULL DEFAULT 'SEEAKK',
    "paymentReferencePrefix" TEXT NOT NULL DEFAULT 'SEEAKK-PAY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedUsers" INTEGER NOT NULL,
    "requestedMonths" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "calculatedAmount" INTEGER NOT NULL,
    "paymentReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAYMENT_REQUIRED',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_paymentReference_key" ON "payment_requests"("paymentReference");

-- CreateIndex
CREATE INDEX "payment_requests_workspaceId_idx" ON "payment_requests"("workspaceId");

-- CreateIndex
CREATE INDEX "payment_requests_createdBy_idx" ON "payment_requests"("createdBy");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

