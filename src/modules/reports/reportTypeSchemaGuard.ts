import prisma from '../../config/prisma';

/** Columns Prisma expects on report_types beyond the initial 20260406 migration. */
export const REQUIRED_REPORT_TYPE_COLUMNS = [
  'modules',
  'baseDataSources',
  'categories',
  'category',
  'trackModules',
  'enableUserFilter',
  'enableDateFilter',
  'trackActivityTypes',
  'allowExport',
  'showSummary',
  'showDetailedLogs',
] as const;

let schemaColumnsEnsured = false;

const runStatements = async (sql: string): Promise<void> => {
  const statements = sql
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('--'));

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(`${statement};`);
  }
};

/**
 * Idempotently adds report_types columns that exist in schema.prisma but may be
 * missing when Prisma migrations were not deployed (e.g. Render only runs npm start).
 */
export const ensureReportTypeSchemaColumns = async (): Promise<void> => {
  if (schemaColumnsEnsured) return;

  await runStatements(`
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
    ALTER TABLE "report_types" ADD COLUMN IF NOT EXISTS "showDetailedLogs" BOOLEAN NOT NULL DEFAULT false
  `);

  await runStatements(`
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
    WHERE "category" IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER TYPE "ReportBaseDataSource" ADD VALUE IF NOT EXISTS 'ACTIVITY';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  schemaColumnsEnsured = true;
};

export const getMissingReportTypeColumns = async (): Promise<string[]> => {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name::text AS column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'report_types'
  `;

  const present = new Set(rows.map((row) => row.column_name.toLowerCase()));
  return REQUIRED_REPORT_TYPE_COLUMNS.filter((col) => !present.has(col.toLowerCase()));
};
