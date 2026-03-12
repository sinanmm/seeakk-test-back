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
  await redisClient.connect();
};

export { redisClient, connectRedis };