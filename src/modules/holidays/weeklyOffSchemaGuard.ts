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

  await runStatements(`
    ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffDays" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[];
    ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffColor" TEXT NOT NULL DEFAULT '#cbd5e1';
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'WEEKLY_OFF';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  weeklyOffSchemaEnsured = true;
  logger.info('[Holidays] Weekly-off schema columns verified');
};
