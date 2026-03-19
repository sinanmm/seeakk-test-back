-- Ensure required columns can be safely enforced on existing data.
UPDATE "stage_rules"
SET
  "name" = COALESCE(NULLIF(TRIM("name"), ''), 'Untitled Rule'),
  "inputType" = COALESCE("inputType", 'TEXT'::"InputType"),
  "sortOrder" = COALESCE("sortOrder", 1),
  "updatedAt" = COALESCE("updatedAt", NOW())
WHERE
  "name" IS NULL OR TRIM("name") = ''
  OR "inputType" IS NULL
  OR "sortOrder" IS NULL
  OR "updatedAt" IS NULL;

ALTER TABLE "stage_rules"
  ALTER COLUMN "name" SET DEFAULT 'Untitled Rule',
  ALTER COLUMN "inputType" SET DEFAULT 'TEXT'::"InputType",
  ALTER COLUMN "sortOrder" SET DEFAULT 1,
  ALTER COLUMN "updatedAt" SET DEFAULT NOW();

ALTER TABLE "stage_rules"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "inputType" SET NOT NULL,
  ALTER COLUMN "sortOrder" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;
