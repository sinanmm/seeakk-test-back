import prisma from '../../../config/prisma';

export class FieldHighlightService {
  /**
   * Fetch all highlight configs for a workspace
   */
  async getWorkspaceConfigs(workspaceId: string) {
    return prisma.fieldHighlightConfig.findMany({
      where: { workspaceId }
    });
  }

  /**
   * Bulk update highlight configs for a workspace
   */
  async updateWorkspaceConfigs(workspaceId: string, configs: { fieldKey: string; isEnabled: boolean }[]) {
    // We can do this in a transaction: upsert each config
    const ops = configs.map(config => 
      prisma.fieldHighlightConfig.upsert({
        where: {
          workspaceId_fieldKey: {
            workspaceId,
            fieldKey: config.fieldKey
          }
        },
        update: {
          isEnabled: config.isEnabled
        },
        create: {
          workspaceId,
          fieldKey: config.fieldKey,
          isEnabled: config.isEnabled
        }
      })
    );

    await prisma.$transaction(ops);
    
    return this.getWorkspaceConfigs(workspaceId);
  }

  /**
   * Fetch edit summary and history for a specific lead
   */
  async getLeadFieldEdits(leadId: string) {
    const summaries = await prisma.leadFieldEditSummary.findMany({
      where: { leadId }
    });
    
    const histories = await prisma.leadFieldEditHistory.findMany({
      where: { leadId },
      include: {
        changedBy: {
          select: { id: true, name: true }
        }
      },
      orderBy: { changedAt: 'desc' }
    });

    return { summaries, histories };
  }
}

export const fieldHighlightService = new FieldHighlightService();
