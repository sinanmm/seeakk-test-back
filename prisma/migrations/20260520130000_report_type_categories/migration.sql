-- Multi-select report categories on report types
ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "categories" JSONB NOT NULL DEFAULT '[]';

UPDATE "report_types"
SET "categories" = to_jsonb(ARRAY[COALESCE("category", 'Leads Report')])
WHERE jsonb_array_length(COALESCE("categories", '[]'::jsonb)) = 0;
