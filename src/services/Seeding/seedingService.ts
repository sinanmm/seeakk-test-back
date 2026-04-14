import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const seedDefaultMasterData = async (workspaceId: string, createdById?: string): Promise<void> => {
  try {
    logger.info(`Seeding default master data for workspace: ${workspaceId}`);

    // 1. Seed Default Lead Sources
    const defaultSources = ['Google', 'Facebook', 'Referral', 'Direct', 'Organic Search'];
    
    await (prisma as any).leadSource.createMany({
      data: defaultSources.map((name) => ({
        name,
        workspaceId,
        createdBy: createdById,
        status: 'ACTIVE',
      })),
      skipDuplicates: true,
    });

    // 2. Seed Default Lead Stages
    const defaultStages = [
      { name: 'New', color: '#10b981', order: 1 },
      { name: 'Contacted', color: '#3b82f6', order: 2 },
      { name: 'Qualified', color: '#f59e0b', order: 3 },
      { name: 'Proposal Sent', color: '#8b5cf6', order: 4 },
      { name: 'Closed Won', color: '#059669', order: 5, isClosed: true },
      { name: 'Closed Lost', color: '#dc2626', order: 6, isClosed: true },
    ];

    for (const stage of defaultStages) {
      await (prisma as any).leadStage.create({
        data: {
          ...stage,
          workspaceId,
          createdBy: createdById,
          status: 'ACTIVE',
        },
      });
    }

    logger.info(`Successfully seeded default master data for workspace: ${workspaceId}`);
  } catch (error) {
    logger.error(`Error seeding default data for workspace ${workspaceId}:`, error);
    // We don't throw here to avoid failing the whole workspace setup if seeding fails
  }
};
