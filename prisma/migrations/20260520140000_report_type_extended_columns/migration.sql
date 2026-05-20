-- Report type user-activity and multi-select columns (sync schema.prisma with production DBs)
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "modules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "baseDataSources" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "categories" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "category" TEXT DEFAULT 'Leads Report';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "trackModules" JSONB DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "enableUserFilter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "enableDateFilter" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "trackActivityTypes" JSONB DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "allowExport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "showSummary" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "showDetailedLogs" BOOLEAN NOT NULL DEFAULT false;

UPDATE "report_types"
SET
  "modules" = to_jsonb(ARRAY["module"::text]),
  "baseDataSources" = to_jsonb(ARRAY["baseDataSource"::text])
WHERE jsonb_array_length(COALESCE("modules", '[]'::jsonb)) = 0
   OR jsonb_array_length(COALESCE("baseDataSources", '[]'::jsonb)) = 0;

UPDATE "report_types"
SET "categories" = to_jsonb(ARRAY[COALESCE("category", 'Leads Report')])
WHERE jsonb_array_length(COALESCE("categories", '[]'::jsonb)) = 0;

UPDATE "report_types"
SET "category" = COALESCE("category", 'Leads Report')
WHERE "category" IS NULL;

DO $$
BEGIN
  ALTER TYPE "ReportBaseDataSource" ADD VALUE IF NOT EXISTS 'ACTIVITY';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
