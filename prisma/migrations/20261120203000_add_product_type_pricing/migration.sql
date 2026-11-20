-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "typeOptions" JSONB DEFAULT '[]'::jsonb;

-- AlterTable
ALTER TABLE "lead_products" ADD COLUMN IF NOT EXISTS "typeId" TEXT;
