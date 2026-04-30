import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { createServer } from 'http';
import { connectRedis } from './config/redis';
import prisma from './config/prisma';
import { scheduleDailySync } from './modules/holidays/holidays.jobs';
import './modules/leads/leadImport.jobs';
import { verifyEmailTransport } from './services/Email/emailService';
import { startFollowUpReminders } from './services/User/followupReminder.jobs';
import { initRealtimeServer } from './realtime/socket';
import { getAllowedOrigins } from './config/cors';

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
  console.log('[Server] Bootstrapping server...');
  try {
    // Connect Redis
    await connectRedis();
    const httpServer = createServer(app);
    initRealtimeServer(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`[Server] Running on port ${PORT}`);
      console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`[Server] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
      console.log(`[Socket.io] Initialized on ${PORT}`);
      try {
        console.log('[CORS] Allowed origins:', getAllowedOrigins());
      } catch (e) {
        console.error('[CORS] Error getting origins:', e);
      }
    });

    verifyEmailTransport()
      .then(() => {
        console.log('✅ Email transport verified');
      })
      .catch((error: any) => {
        console.error('❌ Email transport failed:', error?.message || String(error));
      });

    // Connect Prisma in background so API process can still boot and avoid ERR_CONNECTION_REFUSED.
    connectPrismaWithRetry()
      .then(() => {
        console.log('PostgreSQL connected via Prisma');
        // Start background jobs
        scheduleDailySync().catch(err => console.error('Failed to schedule holiday jobs:', err));
        startFollowUpReminders();
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
