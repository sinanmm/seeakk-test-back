import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectRedis } from './config/redis';
import prisma from './config/prisma';
import { scheduleDailySync } from './modules/holidays/holidays.jobs';
import './modules/leads/leadImport.jobs';

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
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Connect Prisma in background so API process can still boot and avoid ERR_CONNECTION_REFUSED.
    connectPrismaWithRetry()
      .then(() => {
        console.log('PostgreSQL connected via Prisma');
        // Start background jobs
        scheduleDailySync().catch(err => console.error('Failed to schedule holiday jobs:', err));
      })
      .catch((error) => {
        console.error('PostgreSQL initial connection failed. API is running in degraded mode:', error);
      });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
