import { PrismaClient } from '../../prisma/generated/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma client');
}

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
      if (!parsed.searchParams.has('pgbouncer')) {
        parsed.searchParams.set('pgbouncer', 'true');
      }
      if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', '15');
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', '20');
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', '10');
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
