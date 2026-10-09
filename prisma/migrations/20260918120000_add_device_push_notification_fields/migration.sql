-- AlterTable
ALTER TABLE "devices" ADD COLUMN "pushToken" TEXT,
ADD COLUMN "pushProvider" TEXT DEFAULT 'EXPO',
ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "appVersion" TEXT;

-- CreateIndex
CREATE INDEX "devices_userId_pushEnabled_idx" ON "devices"("userId", "pushEnabled");

-- CreateIndex
CREATE INDEX "devices_pushToken_idx" ON "devices"("pushToken");
