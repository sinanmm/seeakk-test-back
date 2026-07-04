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
  // Prisma migrations own these columns in the PostgreSQL schema.
  schemaColumnsEnsured = true;
};

export const getMissingReportTypeColumns = async (): Promise<string[]> => {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'report_types'
  `;

  const present = new Set(rows.map((row) => row.column_name.toLowerCase()));
  return REQUIRED_REPORT_TYPE_COLUMNS.filter((col) => !present.has(col.toLowerCase()));
};


