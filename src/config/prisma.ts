import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma client');
}

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const withConditionalPoolerParams = (url: string): string => {
  try {
    const parsed = new URL(url);

    const hostname = parsed.hostname.toLowerCase();
    const alreadyConfiguredForPooler = parsed.searchParams.get('pgbouncer') === 'true';
    const looksLikePoolerHost =
      hostname.includes('-pooler.') ||
      hostname.includes('.pooler.') ||
      hostname.includes('pgbouncer');

    if (alreadyConfiguredForPooler || looksLikePoolerHost) {
      const connectTimeout = toPositiveNumber(process.env.PRISMA_CONNECT_TIMEOUT, 15);
      const poolTimeout = toPositiveNumber(process.env.PRISMA_POOL_TIMEOUT, 30);
      const connectionLimit = toPositiveNumber(process.env.PRISMA_CONNECTION_LIMIT, 15);

      if (!parsed.searchParams.has('pgbouncer')) {
        parsed.searchParams.set('pgbouncer', 'true');
      }
      if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', String(connectTimeout));
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', String(poolTimeout));
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', String(connectionLimit));
      }
      // PgBouncer does not support prepared statements in transaction mode.
      if (!parsed.searchParams.has('statement_cache_size')) {
        parsed.searchParams.set('statement_cache_size', '0');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
};

const dbUrl = withConditionalPoolerParams(connectionString);

const createPrismaClient = () => {
  const client = new PrismaClient({
    datasources: { db: { url: dbUrl } },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  const isRecoverableConnectionError = (error: unknown): boolean => {
    const message = String((error as any)?.message || '');
    const code = String((error as any)?.code || '');
    return (
      (message.includes('Error in PostgreSQL connection') && message.includes('kind: Closed')) ||
      message.includes('Connection terminated unexpectedly') ||
      message.includes('server closed the connection unexpectedly') ||
      message.includes('Can not perform operation: connection is closed') ||
      message.includes('remaining connection slots are reserved') ||
      code === 'P1017'
    );
  };

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // Retry on transient connection failures from pooled PostgreSQL connections.
  // Do NOT force disconnect/connect here; doing so can interrupt concurrent requests.
  client.$use(async (params, next) => {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      try {
        return await next(params);
      } catch (error: any) {
        lastError = error;
        if (!isRecoverableConnectionError(error)) {
          throw error;
        }

        attempt += 1;
        if (attempt < maxAttempts) {
          await delay(150 * attempt);
        }
      }
    }

    throw lastError;
  });

  return client;
};

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
