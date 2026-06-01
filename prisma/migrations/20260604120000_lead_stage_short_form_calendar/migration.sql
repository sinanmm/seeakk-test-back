ALTER TABLE "lead_stages"
ADD COLUMN IF NOT EXISTS "stageShortForm" TEXT,
ADD COLUMN IF NOT EXISTS "showInCalendar" BOOLEAN NOT NULL DEFAULT true;

UPDATE "lead_stages"
SET "stageShortForm" = UPPER(LEFT(REGEXP_REPLACE(TRIM("name"), '[^a-zA-Z0-9]', '', 'g'), 10))
WHERE "stageShortForm" IS NULL OR TRIM("stageShortForm") = '';

CREATE UNIQUE INDEX IF NOT EXISTS "lead_stages_workspace_short_form_key"
ON "lead_stages" ("workspaceId", "stageShortForm")
WHERE "deletedAt" IS NULL AND "stageShortForm" IS NOT NULL;
