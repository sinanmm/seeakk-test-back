import prisma from '../../config/prisma';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';

const db = prisma as any;

export type TemporaryBulkAccessRecord = {
  id: string;
  userId: string;
  workspaceId: string;
  grantedById: string;
  duration: string;
  startsAt: Date;
  expiresAt: Date;
  isActive: boolean;
  createdAt: Date;
};

export const deactivateExpiredTemporaryBulkAccess = async (
  workspaceId?: string,
): Promise<number> => {
  const now = new Date();
  const result = await db.temporaryBulkExtensionAccess.updateMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      isActive: true,
      expiresAt: { lt: now },
    },
    data: { isActive: false },
  });
  return result.count ?? 0;
};

export const findActiveTemporaryBulkExtensionAccess = async (
  userId: string,
  workspaceId: string | null | undefined,
): Promise<TemporaryBulkAccessRecord | null> => {
  if (!userId || !workspaceId) return null;

  await deactivateExpiredTemporaryBulkAccess(workspaceId);

  const now = new Date();
  return db.temporaryBulkExtensionAccess.findFirst({
    where: {
      userId,
      workspaceId,
      isActive: true,
      startsAt: { lte: now },
      expiresAt: { gte: now },
    },
    orderBy: { expiresAt: 'desc' },
  });
};

export const userHasActiveTemporaryBulkExtensionAccess = async (
  userId: string,
  workspaceId: string | null | undefined,
): Promise<boolean> => {
  const record = await findActiveTemporaryBulkExtensionAccess(userId, workspaceId);
  return Boolean(record);
};

export const resolveWorkspaceIdForBulkAccessUser = async (
  userId: string,
  workspaceId?: string | null,
): Promise<string | null> => resolveWorkspaceIdForUser(userId, workspaceId ?? null);
