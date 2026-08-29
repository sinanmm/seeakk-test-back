import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricePerUserMonth: number;
  currency: string;
  isActive: boolean;
  isArchived: boolean;
}

export class ModuleEntitlementService {
  /**
   * Retrieves the active plan for a workspace.
   */
  static async getWorkspacePlan(workspaceId: string): Promise<PlanSummary | null> {
    if (!workspaceId) return null;

    const workspace: any = await (prisma as any).workspace.findUnique({
      where: { id: workspaceId },
      include: { activePlan: true },
    });

    if (!workspace || !workspace.activePlan) {
      return null;
    }

    const plan = workspace.activePlan;
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description || null,
      pricePerUserMonth: plan.pricePerUserMonth,
      currency: plan.currency || 'INR',
      isActive: Boolean(plan.isActive),
      isArchived: Boolean(plan.isArchived),
    };
  }

  /**
   * Retrieves the list of enabled module keys for a workspace.
   * Backward-compatibility: If workspace has no activePlanId (legacy unmanaged),
   * all canonical active modules are returned enabled so old companies never break.
   */
  static async getEnabledModules(workspaceId: string): Promise<string[]> {
    if (!workspaceId) return [];

    const workspace: any = await (prisma as any).workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, activePlanId: true, billingStatus: true },
    });

    if (!workspace) return [];

    // Legacy unmanaged workspace backward compatibility:
    // If activePlanId is null, grant access to all active canonical modules.
    if (!workspace.activePlanId) {
      const allModules: any[] = await (prisma as any).appModule.findMany({
        where: { isActive: true },
        select: { key: true },
      });
      return allModules.map((m: any) => m.key);
    }

    // Plan-based entitlement:
    const planModules: any[] = await (prisma as any).planModule.findMany({
      where: {
        planId: workspace.activePlanId,
        enabled: true,
        module: { isActive: true },
      },
      include: {
        module: { select: { key: true } },
      },
    });

    return planModules.map((pm: any) => pm.module.key);
  }

  /**
   * Checks if a workspace is entitled to a specific module key.
   */
  static async hasModule(workspaceId: string, moduleKey: string): Promise<boolean> {
    if (!workspaceId || !moduleKey) return false;
    const enabledModules = await this.getEnabledModules(workspaceId);
    return enabledModules.includes(moduleKey);
  }

  /**
   * Asserts that a workspace has access to the specified module key,
   * otherwise throws a 403 error.
   */
  static async assertModuleAccess(workspaceId: string, moduleKey: string): Promise<void> {
    const isAllowed = await this.hasModule(workspaceId, moduleKey);
    if (!isAllowed) {
      const error: any = new Error(
        `Your current subscription plan does not include access to the '${moduleKey}' module.`
      );
      error.statusCode = 403;
      error.errorCode = 'MODULE_NOT_ENABLED';
      error.module = moduleKey;
      throw error;
    }
  }
}
