import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const seedDefaultMasterData = async (workspaceId: string, createdById?: string): Promise<void> => {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!ws) {
    logger.warn('seedDefaultMasterData: skipped — workspaceId is missing.');
    return;
  }

  try {
    logger.info(`Seeding default master data for workspace: ${ws}`);

    // 1. Seed Default Lead Sources
    const defaultSources = ['Google', 'Facebook', 'Referral', 'Direct', 'Organic Search'];
    
    await (prisma as any).leadSource.createMany({
      data: defaultSources.map((name) => ({
        name,
        workspaceId: ws,
        createdBy: createdById,
        status: 'ACTIVE',
      })),
      skipDuplicates: true,
    });

    // 2. Seed Default Lead Stages
    // Product baseline for every newly onboarded workspace:
    // 1. New (no approval)
    // 2. Qualified (approval required)
    // 3. Potential Qualified (approval required)
    // 4. Closed (approval required + isClosed)
    // 5. LOB (isLOB)
    //
    // Use upsert to keep this idempotent and safe on retries.
    const defaultStages = [
      {
        name: 'New',
        color: '#10b981',
        order: 1,
        isApprovalRequired: false,
        isClosed: false,
        isLOB: false,
      },
      {
        name: 'Qualified',
        color: '#f59e0b',
        order: 2,
        isApprovalRequired: true,
        isClosed: false,
        isLOB: false,
      },
      {
        name: 'Potential Qualified',
        color: '#3b82f6',
        order: 3,
        isApprovalRequired: true,
        isClosed: false,
        isLOB: false,
      },
      {
        name: 'Closed',
        color: '#059669',
        order: 4,
        isApprovalRequired: true,
        isClosed: true,
        isLOB: false,
      },
      {
        name: 'LOB',
        color: '#dc2626',
        order: 5,
        isApprovalRequired: false,
        isClosed: false,
        isLOB: true,
      },
    ] as const;

    await prisma.$transaction(
      defaultStages.map((stage) =>
        (prisma as any).leadStage.upsert({
          where: {
            workspaceId_name: {
              workspaceId: ws,
              name: stage.name,
            },
          },
          update: {
            color: stage.color,
            order: stage.order,
            isApprovalRequired: stage.isApprovalRequired,
            isClosed: stage.isClosed,
            isLOB: stage.isLOB,
            status: 'ACTIVE',
            deletedAt: null,
          },
          create: {
            workspaceId: ws,
            name: stage.name,
            color: stage.color,
            order: stage.order,
            isApprovalRequired: stage.isApprovalRequired,
            isClosed: stage.isClosed,
            isLOB: stage.isLOB,
            status: 'ACTIVE',
            createdBy: createdById,
          },
        }),
      ),
    );

    logger.info(`Successfully seeded default master data for workspace: ${ws}`);
  } catch (error) {
    logger.error(`Error seeding default data for workspace ${ws}:`, error);
    // We don't throw here to avoid failing the whole workspace setup if seeding fails
  }
};
