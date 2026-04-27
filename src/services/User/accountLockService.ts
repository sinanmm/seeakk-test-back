import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';

const normalizeRoleKey = (value?: string | null): string =>
  (value || '').toLowerCase().trim().replace(/[\s_-]+/g, '');

const isSuperAdminRole = (value?: string | null): boolean =>
  normalizeRoleKey(value) === 'superadmin';

/**
 * Invalidate all Redis refresh tokens belonging to a specific userId.
 */
const invalidateUserSessions = async (userId: string): Promise<void> => {
  try {
    if (!redisClient.isReady) return;

    let cursor = 0;
    do {
      const reply = await (redisClient as any).scan(cursor, { MATCH: 'refresh:*', COUNT: 100 });
      cursor = Number(reply.cursor);

      for (const key of reply.keys) {
        const storedUserId = await redisClient.get(key);
        if (storedUserId === userId) {
          await redisClient.del(key);
        }
      }
    } while (cursor !== 0);
  } catch (err: any) {
    logger.warn('Failed to invalidate Redis sessions for locked user', { userId, error: err.message });
  }
};

/**
 * Logically lock a user account.
 */
export const lockUser = async (userId: string, workspaceId: string, reason?: string) => {
  const user = await (prisma as any).user.update({
    where: { id: userId, workspaceId } as any,
    data: { isLocked: true },
  });

  await invalidateUserSessions(userId);
  
  logger.info('User account locked', { userId, workspaceId, reason });
  return user;
};

export const unlockUser = async (
  userId: string,
  workspaceId: string,
  actor: { id: string; roleName?: string | null },
) => {
  const targetUser = await (prisma as any).user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: {
      id: true,
      isLocked: true,
      supervisorId: true,
      workspaceId: true,
    },
  });

  if (!targetUser) {
    const error: any = new Error('User not found in this workspace.');
    error.statusCode = 404;
    throw error;
  }

  if (!targetUser.isLocked) {
    const error: any = new Error('User account is not locked.');
    error.statusCode = 409;
    throw error;
  }

  const actorIsSuperAdmin = isSuperAdminRole(actor.roleName);
  const actorIsSupervisor = Boolean(targetUser.supervisorId && targetUser.supervisorId === actor.id);
  if (!actorIsSuperAdmin && !actorIsSupervisor) {
    const error: any = new Error('Only the selected supervisor or superadmin can unlock this staff account.');
    error.statusCode = 403;
    throw error;
  }

  const user = await (prisma as any).user.update({
    where: { id: targetUser.id },
    data: { isLocked: false },
  });

  logger.info('User account unlocked', {
    userId,
    workspaceId,
    unlockedBy: actor.id,
    unlockedByRole: actor.roleName || null,
  });
  return user;
};
