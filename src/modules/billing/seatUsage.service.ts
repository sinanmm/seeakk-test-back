import prisma from '../../config/prisma';

export const getSeatUsage = async (workspaceId: string) => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { approvedUserLimit: true },
  });

  const approvedUserLimit = workspace?.approvedUserLimit || 0;

  // Count active, non-deleted users
  const activeUserCount = await prisma.user.count({
    where: {
      workspaceId,
      isActive: true,
      deletedAt: null,
    },
  });

  const availableUserCount = Math.max(0, approvedUserLimit - activeUserCount);

  return {
    approvedUserLimit,
    activeUserCount,
    availableUserCount,
  };
};

export const verifySeatLimit = async (workspaceId: string, additionalSeats: number = 1) => {
  const usage = await getSeatUsage(workspaceId);

  // If approvedUserLimit is null, it's a legacy company not managed by new billing
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { approvedUserLimit: true },
  });

  if (!workspace || workspace.approvedUserLimit === null) {
    return true; // Unrestricted for legacy companies
  }

  if (usage.activeUserCount + additionalSeats > usage.approvedUserLimit) {
    const error: any = new Error('USER_LIMIT_REACHED: Your current SEEAKK subscription limit has been reached.');
    error.statusCode = 400;
    error.code = 'USER_LIMIT_REACHED';
    throw error;
  }

  return true;
};
