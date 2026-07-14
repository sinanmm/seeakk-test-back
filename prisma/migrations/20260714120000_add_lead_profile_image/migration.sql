ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "profileImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "profileImageThumbnail" TEXT,
  ADD COLUMN IF NOT EXISTS "profileImageUploadedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "profileImageUploadedById" TEXT;

