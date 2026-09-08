import { redisClient } from '../config/redis';

/** Matches JWT refresh expiry (7d) in RefreshToken.ts */
export const REFRESH_SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** Brief cache so parallel refresh calls with the same token get the same rotation result */
export const REFRESH_REPLAY_TTL_SEC = 30;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForRedisReady = async (maxWaitMs = 3000): Promise<boolean> => {
  if (redisClient.isReady) return true;

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (redisClient.isReady) return true;
    await sleep(100);
  }

  return redisClient.isReady;
};

const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX?.trim() || '';
const scopedKey = (key: string): string => (REDIS_KEY_PREFIX ? `${REDIS_KEY_PREFIX}:${key}` : key);

export const storeRefreshSession = async (tokenId: string, userId: string): Promise<void> => {
  if (!redisClient.isReady) return;
  await redisClient.setEx(scopedKey(`refresh:${tokenId}`), REFRESH_SESSION_TTL_SEC, userId);
};

export const getRefreshReplay = async (tokenId: string): Promise<string | null> => {
  if (!redisClient.isReady) return null;
  const primary = await redisClient.get(scopedKey(`refresh:replay:${tokenId}`));
  if (primary || !REDIS_KEY_PREFIX) return primary;
  return redisClient.get(`refresh:replay:${tokenId}`);
};

export const cacheRefreshReplay = async (tokenId: string, payload: string): Promise<void> => {
  if (!redisClient.isReady) return;
  await redisClient.setEx(scopedKey(`refresh:replay:${tokenId}`), REFRESH_REPLAY_TTL_SEC, payload);
};

export const getStoredRefreshUserId = async (tokenId: string): Promise<string | null> => {
  if (!redisClient.isReady) return null;
  const primary = await redisClient.get(scopedKey(`refresh:${tokenId}`));
  if (primary || !REDIS_KEY_PREFIX) return primary;
  return redisClient.get(`refresh:${tokenId}`);
};

export const revokeRefreshSession = async (tokenId: string): Promise<void> => {
  if (!redisClient.isReady) return;
  await redisClient.del(scopedKey(`refresh:${tokenId}`));
  if (REDIS_KEY_PREFIX) {
    await redisClient.del(`refresh:${tokenId}`);
  }
};

/** Marks a rotated refresh token as consumed so it cannot be replayed after the short replay window */
export const markRefreshTokenUsed = async (tokenId: string, userId: string): Promise<void> => {
  if (!redisClient.isReady) return;
  await redisClient.setEx(scopedKey(`refresh:used:${tokenId}`), REFRESH_SESSION_TTL_SEC, userId);
};

export const getUsedRefreshUserId = async (tokenId: string): Promise<string | null> => {
  if (!redisClient.isReady) return null;
  const primary = await redisClient.get(scopedKey(`refresh:used:${tokenId}`));
  if (primary || !REDIS_KEY_PREFIX) return primary;
  return redisClient.get(`refresh:used:${tokenId}`);
};
