import prisma from '../../config/prisma';
import logger from '../../utils/logger';

let weeklyOffSchemaEnsured = false;

/**
 * Ensures workspace weekly-off columns exist even when Prisma migrations were not applied
 * (e.g. Render deploy without migrate deploy completing).
 */
export const ensureWeeklyOffSchema = async (): Promise<void> => {
  if (weeklyOffSchemaEnsured) return;

  try {
    await prisma.$executeRaw`
      ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffDays" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[];
    `;
    await prisma.$executeRaw`
      ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffColor" TEXT NOT NULL DEFAULT '#cbd5e1';
    `;

    await prisma.$executeRaw`
      DO $$
      BEGIN
        ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'WEEKLY_OFF';
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `;

    weeklyOffSchemaEnsured = true;
    logger.info('[Holidays] Weekly-off schema verified');
  } catch (error) {
    logger.error('[Holidays] Failed to verify weekly-off schema', error);
  }
};
