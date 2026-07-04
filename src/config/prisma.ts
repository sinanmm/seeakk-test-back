import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; directPrisma?: PrismaClient };

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
        parsed.searchParams.set('connect_timeout', String(Math.max(connectTimeout, 20)));
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', String(Math.max(poolTimeout, 60)));
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', String(Math.min(connectionLimit, 10)));
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
    // Interactive `$transaction(async (tx) => …)` can span multiple round-trips; pooled
    // serverless DBs (e.g. Neon) occasionally need more than the default budget.
    transactionOptions: {
      maxWait: toPositiveNumber(process.env.PRISMA_TRANSACTION_MAX_WAIT_MS, 5000),
      timeout: toPositiveNumber(process.env.PRISMA_TRANSACTION_TIMEOUT_MS, 20000),
    },
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

  /** Must never be re-invoked: a retry would use a stale interactive transaction id (P2028). */
  const isNonRetryableTransactionProtocolError = (error: unknown): boolean => {
    const code = String((error as any)?.code || '');
    const message = String((error as any)?.message || '');
    return (
      code === 'P2028' ||
      code === 'P2034' ||
      message.includes('Transaction not found') ||
      message.includes('Transaction API error') ||
      message.includes('closed transaction') ||
      message.includes('invalid transaction')
    );
  };

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  // Retry on transient connection failures from pooled PostgreSQL connections.
  // Do NOT force disconnect/connect here; doing so can interrupt concurrent requests.
  client.$use(async (params: any, next: any) => {
    // Any query tied to a server-side transaction (interactive `tx.*` or batch `$transaction([...])`)
    // must not be retried: a second `next()` can run on another connection / stale tx id → P2028.
    const inTransaction =
      params?.runInTransaction === true ||
      params?.runInTransaction === 'true' ||
      (params?.transaction !== undefined && params?.transaction !== null);
    if (inTransaction) {
      return next(params);
    }

    const maxAttempts = 5;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      try {
        return await next(params);
      } catch (error: any) {
        lastError = error;
        if (isNonRetryableTransactionProtocolError(error)) {
          throw error;
        }
        if (!isRecoverableConnectionError(error)) {
          throw error;
        }

        attempt += 1;
        if (attempt < maxAttempts) {
          // Exponential backoff: 300ms, 600ms, 900ms, 1200ms...
          await delay(300 * attempt);
        }
      }
    }

    throw lastError;
  });

  return client;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Reuse one client in all environments (serverless / hot reload safe). Without this,
// production can instantiate a new PrismaClient per cold start edge case and stack middleware.
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma;
}

const directUrl = process.env.DIRECT_URL || connectionString;
export const directPrisma = globalForPrisma.directPrisma ?? new PrismaClient({
  datasources: { db: { url: directUrl } },
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (!globalForPrisma.directPrisma) {
  globalForPrisma.directPrisma = directPrisma;
}

export default prisma;


