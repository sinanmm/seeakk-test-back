import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('connect', () => {
  console.log('Redis connected');
});

redisClient.on('error', (err: any) => {
  console.error('Redis error:', err);
});

const connectRedis = async (): Promise<void> => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('Redis URL not configured. Skipping Redis startup.');
    return;
  }

  if (redisClient.isOpen) return;

  const timeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 3000);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Redis connect timeout after ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([redisClient.connect(), timeout]);
  } catch (error) {
    console.warn('Redis startup skipped (will continue without Redis cache):', (error as any)?.message || error);
  }
};

export { redisClient, connectRedis };
