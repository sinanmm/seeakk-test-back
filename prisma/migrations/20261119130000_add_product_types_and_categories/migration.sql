-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "types" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill categories from category if existing
UPDATE "products"
SET "categories" = ARRAY["category"]
WHERE "category" IS NOT NULL
  AND "category" <> ''
  AND ("categories" IS NULL OR "categories" = ARRAY[]::TEXT[]);

-- AlterTable
ALTER TABLE "lead_products" ADD COLUMN IF NOT EXISTS "type" TEXT;
ALTER TABLE "lead_products" ADD COLUMN IF NOT EXISTS "category" TEXT;
