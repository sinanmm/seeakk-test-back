import { Redis, RedisOptions } from 'ioredis';
import logger from '../utils/logger';

const redisUrl = process.env.REDIS_URL?.trim();

let sharedRedisConnection: Redis | null = null;

export const getBullMQConnection = (): Redis | RedisOptions => {
  if (!redisUrl) {
    throw new Error('REDIS_URL is not configured');
  }

  // BullMQ requires maxRetriesPerRequest to be null when using a shared connection or standard Redis instance
  // This prevents BullMQ from crashing when Redis is temporarily unavailable
  const commonOptions: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true, // Don't connect until needed
  };

  // If we want to strictly minimize connections, we could return a shared instance.
  // However, BullMQ documentation recommends separate connections for Queue, Worker, and Events
  // if they are doing heavy lifting. 
  // BUT on free tiers (like Redis Labs), we MUST share to avoid "max number of clients reached".
  
  if (!sharedRedisConnection) {
    sharedRedisConnection = new Redis(redisUrl, {
      ...commonOptions,
    });

    sharedRedisConnection.on('error', (err) => {
      logger.error('BullMQ Shared Redis Connection Error', { error: err.message });
    });

    sharedRedisConnection.on('connect', () => {
      logger.info('BullMQ Shared Redis Connected');
    });
  }

  return sharedRedisConnection;
};

/**
 * For standard configuration without sharing an instance (still using the same URL)
 */
export const getBullMQConfig = () => {
  if (!redisUrl) return null;
  return {
    connection: {
      url: redisUrl,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }
  };
};

export const closeBullMQConnections = async () => {
  if (sharedRedisConnection) {
    await sharedRedisConnection.quit();
    sharedRedisConnection = null;
    logger.info('BullMQ Shared Redis Connection closed');
  }
};
