import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';

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

/**
 * Unlock a user account.
 */
export const unlockUser = async (userId: string, workspaceId: string) => {
  const user = await (prisma as any).user.update({
    where: { id: userId, workspaceId } as any,
    data: { isLocked: false },
  });

  logger.info('User account unlocked', { userId, workspaceId });
  return user;
};
