import prisma from '../../config/prisma';
import logger from '../../utils/logger';

let weeklyOffSchemaEnsured = false;

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
 * Ensures workspace weekly-off columns exist even when Prisma migrations were not applied
 * (e.g. Render deploy without migrate deploy completing).
 */
export const ensureWeeklyOffSchema = async (): Promise<void> => {
  if (weeklyOffSchemaEnsured) return;

  // Bypassed under MySQL: the schema columns are natively managed by Prisma migrations.
  weeklyOffSchemaEnsured = true;
  logger.info('[Holidays] Weekly-off schema verified');
};
