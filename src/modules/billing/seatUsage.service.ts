import prisma from '../../config/prisma';

export interface SeatUsageResult {
  approvedUserLimit: number;
  activeUserCount: number;
  availableUserCount: number;
  effectiveUserLimit: number | null;
  entitlementSource: 'GRACE' | 'PAID' | 'LEGACY' | 'NONE';
}

export const getSeatUsage = async (workspaceId: string, tx?: any): Promise<SeatUsageResult> => {
  const client = tx || prisma;
  const now = new Date();

  const [workspace, activeGrace, activeUserCount] = await Promise.all([
    client.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        approvedUserLimit: true,
        billingStatus: true,
        accessUntil: true,
      },
    }),
    client.graceRecord.findFirst({
      where: {
        workspaceId,
        status: 'ACTIVE',
        graceUntil: { gt: now },
      },
      orderBy: { graceUntil: 'desc' },
      select: { allowedUserLimit: true },
    }),
    client.user.count({
      where: {
        workspaceId,
        isActive: true,
        deletedAt: null,
      },
    }),
  ]);

  let effectiveUserLimit: number | null = null;
  let entitlementSource: 'GRACE' | 'PAID' | 'LEGACY' | 'NONE' = 'NONE';

  // 1. Active grace period takes precedence for seat limits
  if (activeGrace) {
    effectiveUserLimit = activeGrace.allowedUserLimit;
    entitlementSource = 'GRACE';
  } else if (workspace && workspace.approvedUserLimit !== null && workspace.approvedUserLimit !== undefined) {
    // 2. Approved user limit (set by payment approval or Control Software company override)
    effectiveUserLimit = workspace.approvedUserLimit;
    entitlementSource = 'PAID';
  } else if (workspace && !workspace.billingStatus && !workspace.accessUntil) {
    // 3. Legacy unmanaged workspace with no limit configured
    effectiveUserLimit = null;
    entitlementSource = 'LEGACY';
  } else if (workspace) {
    // 4. Default fallback
    effectiveUserLimit = workspace.approvedUserLimit || 0;
    entitlementSource = 'PAID';
  }

  const approvedLimitNumber = effectiveUserLimit !== null ? effectiveUserLimit : 0;
  const availableUserCount = effectiveUserLimit !== null ? Math.max(0, effectiveUserLimit - activeUserCount) : 0;

  return {
    approvedUserLimit: approvedLimitNumber,
    activeUserCount,
    availableUserCount,
    effectiveUserLimit,
    entitlementSource,
  };
};

export const verifySeatLimit = async (workspaceId: string, additionalSeats: number = 1, tx?: any): Promise<boolean> => {
  const client = tx || prisma;
  const usage = await getSeatUsage(workspaceId, client);

  // If effectiveUserLimit is null (unrestricted legacy company), allow
  if (usage.effectiveUserLimit === null) {
    return true;
  }

  if (usage.activeUserCount + additionalSeats > usage.effectiveUserLimit) {
    const error: any = new Error(
      `User limit reached. This workspace has reached its maximum of ${usage.effectiveUserLimit} users. Please remove an existing user or contact your administrator to increase the user limit.`
    );
    error.statusCode = 400;
    error.code = 'USER_LIMIT_REACHED';
    throw error;
  }

  return true;
};
