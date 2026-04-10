-- AlterTable
ALTER TABLE "offices"
  ADD COLUMN IF NOT EXISTS "countryId" TEXT,
  ADD COLUMN IF NOT EXISTS "stateId" TEXT,
  ADD COLUMN IF NOT EXISTS "districtId" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "offices_name_idx" ON "offices"("name");
CREATE INDEX IF NOT EXISTS "offices_countryId_idx" ON "offices"("countryId");
CREATE INDEX IF NOT EXISTS "offices_stateId_idx" ON "offices"("stateId");
CREATE INDEX IF NOT EXISTS "offices_districtId_idx" ON "offices"("districtId");
