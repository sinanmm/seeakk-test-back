-- Multi-select report type configuration (modules + base data sources)
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "modules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "baseDataSources" JSONB NOT NULL DEFAULT '[]';

-- Backfill from legacy single-value columns
UPDATE "report_types"
SET
  "modules" = to_jsonb(ARRAY["module"::text]),
  "baseDataSources" = to_jsonb(ARRAY["baseDataSource"::text])
WHERE jsonb_array_length(COALESCE("modules", '[]'::jsonb)) = 0
   OR jsonb_array_length(COALESCE("baseDataSources", '[]'::jsonb)) = 0;
