import prisma from '../../config/prisma';
import logger from '../../utils/logger';

type DefaultLeadStageSeed = {
  name: string;
  color: string;
  order: number;
  isApprovalRequired: boolean;
  isClosed: boolean;
  isLOB: boolean;
};

const DEFAULT_LEAD_STAGES: DefaultLeadStageSeed[] = [
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
];

const normalizeName = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

export const ensureDefaultLeadStagesForWorkspace = async (
  workspaceId: string,
  createdById?: string,
): Promise<{ created: number; updated: number }> => {
  const ws = typeof workspaceId === 'string' ? workspaceId.trim() : '';
  if (!ws) return { created: 0, updated: 0 };

  const existingStages = await (prisma as any).leadStage.findMany({
    where: {
      workspaceId: ws,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      order: true,
      isApprovalRequired: true,
      isClosed: true,
      isLOB: true,
      status: true,
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  const existingByName = new Map<string, any>();
  for (const stage of existingStages) {
    const key = normalizeName(stage.name);
    if (!existingByName.has(key)) {
      existingByName.set(key, stage);
    }
  }

  let nextOrder = existingStages.reduce((max: number, stage: any) => Math.max(max, stage.order || 0), 0) + 1;
  let created = 0;
  let updated = 0;

  for (const stage of DEFAULT_LEAD_STAGES) {
    const existing = existingByName.get(normalizeName(stage.name));

    if (existing) {
      await (prisma as any).leadStage.update({
        where: { id: existing.id },
        data: {
          isApprovalRequired: stage.isApprovalRequired,
          isClosed: stage.isClosed,
          isLOB: stage.isLOB,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      updated += 1;
      continue;
    }

    await (prisma as any).leadStage.create({
      data: {
        workspaceId: ws,
        name: stage.name,
        color: stage.color,
        order: nextOrder,
        isApprovalRequired: stage.isApprovalRequired,
        isClosed: stage.isClosed,
        isLOB: stage.isLOB,
        status: 'ACTIVE',
        createdBy: createdById,
      },
    });
    created += 1;
    nextOrder += 1;
  }

  return { created, updated };
};

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

    // 2. Ensure default lead stages for this workspace
    await ensureDefaultLeadStagesForWorkspace(ws, createdById);

    logger.info(`Successfully seeded default master data for workspace: ${ws}`);
  } catch (error) {
    logger.error(`Error seeding default data for workspace ${ws}:`, error);
    // We don't throw here to avoid failing the whole workspace setup if seeding fails
  }
};
