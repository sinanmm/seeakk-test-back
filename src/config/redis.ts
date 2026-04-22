import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger';

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_KEEP_ALIVE_PING_MS = 30000;
const DEFAULT_SOCKET_KEEP_ALIVE_MS = 60000;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5000;

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const redisUrl = process.env.REDIS_URL?.trim();
const connectTimeoutMs = toPositiveNumber(
  process.env.REDIS_CONNECT_TIMEOUT_MS,
  DEFAULT_CONNECT_TIMEOUT_MS,
);
const keepAlivePingMs = toPositiveNumber(
  process.env.REDIS_KEEP_ALIVE_PING_MS,
  DEFAULT_KEEP_ALIVE_PING_MS,
);
const maxReconnectDelayMs = toPositiveNumber(
  process.env.REDIS_MAX_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
);

const redisClient: RedisClientType = createClient({
  ...(redisUrl ? { url: redisUrl } : {}),
  socket: {
    connectTimeout: connectTimeoutMs,
    keepAlive: true,
    noDelay: true,
    reconnectStrategy: (retries: number, cause: Error) => {
      const delay = Math.min(100 * 2 ** retries, maxReconnectDelayMs);

      logger.warn('Redis reconnect scheduled', {
        module: 'redis',
        attempt: retries + 1,
        delayMs: delay,
        error: getErrorMessage(cause),
      });

      return delay;
    },
  },
});

let connectPromise: Promise<void> | null = null;
let keepAliveInterval: NodeJS.Timeout | null = null;

const clearKeepAliveInterval = (): void => {
  if (!keepAliveInterval) return;
  clearInterval(keepAliveInterval);
  keepAliveInterval = null;
};

const startKeepAliveInterval = (): void => {
  if (keepAliveInterval || keepAlivePingMs <= 0) return;

  keepAliveInterval = setInterval(async () => {
    if (!redisClient.isReady) return;

    try {
      await redisClient.ping();
    } catch (error) {
      logger.warn('Redis keep-alive ping failed', {
        module: 'redis',
        error: getErrorMessage(error),
      });
    }
  }, keepAlivePingMs);

  keepAliveInterval.unref?.();
};

redisClient.on('connect', () => {
  logger.info('Redis socket connected', {
    module: 'redis',
    urlConfigured: Boolean(redisUrl),
  });
});

redisClient.on('ready', () => {
  logger.info('Redis client ready', {
    module: 'redis',
    keepAlivePingMs,
    socketKeepAliveEnabled: true,
  });
  startKeepAliveInterval();
});

redisClient.on('reconnecting', () => {
  logger.warn('Redis client reconnecting', {
    module: 'redis',
  });
  clearKeepAliveInterval();
});

redisClient.on('end', () => {
  logger.warn('Redis connection closed', {
    module: 'redis',
  });
  clearKeepAliveInterval();
});

// node-redis requires an error listener so connection errors do not bubble and crash the process.
redisClient.on('error', (error: unknown) => {
  logger.error('Redis client error', {
    module: 'redis',
    error: getErrorMessage(error),
  });
});

const connectRedis = async (): Promise<void> => {
  if (!redisUrl) {
    logger.warn('Redis URL not configured. Continuing without Redis cache.', {
      module: 'redis',
    });
    return;
  }

  if (redisClient.isReady || redisClient.isOpen) {
    return;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    const startupTimeoutMs = connectTimeoutMs + 1000;

    try {
      await Promise.race([
        redisClient.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Redis startup timeout after ${startupTimeoutMs}ms`)), startupTimeoutMs),
        ),
      ]);
    } catch (error) {
      logger.warn('Redis unavailable at startup. Continuing in degraded mode.', {
        module: 'redis',
        error: getErrorMessage(error),
      });
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
};

const disconnectRedis = async (): Promise<void> => {
  clearKeepAliveInterval();

  if (!redisClient.isOpen) {
    return;
  }

  try {
    await redisClient.quit();
    logger.info('Redis client disconnected gracefully', {
      module: 'redis',
    });
  } catch (error) {
    logger.warn('Redis quit failed, forcing disconnect', {
      module: 'redis',
      error: getErrorMessage(error),
    });
    await redisClient.disconnect();
  }
};

export { connectRedis, disconnectRedis, redisClient };
