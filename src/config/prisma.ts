import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

type PrismaClientType = PrismaClient;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientType };

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma client');
}

const adapter = new PrismaPg({ connectionString });

export const prisma: PrismaClientType =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
