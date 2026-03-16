import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as pg from 'pg';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma client');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool as any);

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter: adapter as any, // Type mismatch in some Prisma versions
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
