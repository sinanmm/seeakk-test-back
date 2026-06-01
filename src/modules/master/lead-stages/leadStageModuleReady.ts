import prisma from '../../../config/prisma';

const leadStageDelegate = (prisma as any).leadStage;
let leadStageModuleReadyValidUntil = 0;
const MODULE_CHECK_TTL_MS = 60_000;

/**
 * Ensures DB columns and generated Prisma client include calendar short-form fields.
 * Without `prisma generate` after migration, Prisma silently ignores unknown fields and saves appear to succeed.
 */
export const assertLeadStageModuleReady = async (): Promise<void> => {
  if (Date.now() < leadStageModuleReadyValidUntil) {
    return;
  }

  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name::text AS column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'lead_stages'
      AND column_name IN ('stageShortForm', 'showInCalendar')
  `;

  const present = new Set(columns.map((row) => row.column_name));
  const missing = ['stageShortForm', 'showInCalendar'].filter((col) => !present.has(col));

  if (missing.length > 0) {
    const error: any = new Error(
      `Lead Stages module is not ready: missing database columns (${missing.join(', ')}). Run npx prisma migrate deploy.`,
    );
    error.statusCode = 503;
    throw error;
  }

  const modelFields = (prisma as any).LeadStage?.fields ?? {};
  const clientHasShortForm = Boolean(modelFields.stageShortForm);
  const clientHasShowInCalendar = Boolean(modelFields.showInCalendar);

  if (!clientHasShortForm || !clientHasShowInCalendar) {
    const error: any = new Error(
      'Lead Stages module is not ready: Prisma client is stale (stageShortForm/showInCalendar missing). Run npx prisma generate and restart the API.',
    );
    error.statusCode = 503;
    throw error;
  }

  try {
    await leadStageDelegate.findFirst({
      where: { deletedAt: null },
      select: { id: true, stageShortForm: true, showInCalendar: true },
    });
  } catch (error: any) {
    const message: any = new Error(
      'Lead Stages module is not ready: Prisma client cannot query stageShortForm/showInCalendar. Run npx prisma generate and restart the API.',
    );
    message.statusCode = 503;
    throw message;
  }

  leadStageModuleReadyValidUntil = Date.now() + MODULE_CHECK_TTL_MS;
};
