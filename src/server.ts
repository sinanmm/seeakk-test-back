import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectRedis } from './config/redis';
import prisma from './config/prisma';

const PORT = process.env.PORT || 5000;

const connectPrismaWithRetry = async (): Promise<void> => {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$connect();
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const delayMs = 250 * attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
};

const startServer = async () => {
  try {
    // Connect Redis
    await connectRedis().catch((error) => {
      console.warn('Redis startup skipped (will continue without Redis cache):', error?.message || error);
    });

    // Test Prisma / PostgreSQL connection
    await connectPrismaWithRetry();
    console.log('PostgreSQL connected via Prisma');

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
