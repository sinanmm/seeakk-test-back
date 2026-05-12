/**
 * Production HTTP stack (required for Socket.IO on Render):
 * - Single Node HTTP server: createServer(app)
 * - Socket.IO attaches to that server (never call app.listen() elsewhere)
 * - Listen on 0.0.0.0:PORT so Render can route traffic
 * - Engine.IO path defaults to /socket.io (see socketConstants + realtime/socket.ts)
 */
import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { connectRedis } from './config/redis';
import { getAllowedOrigins } from './config/cors';
import { logStartupDiagnostics } from './config/startupDiagnostics';

const PORT = Number.parseInt(String(process.env.PORT || '5000'), 10) || 5000;

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception during startup/runtime:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection during startup/runtime:', reason);
});

const validateCriticalEnv = (): void => {
  const missing: string[] = [];

  if (!process.env.DATABASE_URL?.trim()) missing.push('DATABASE_URL');
  if (!process.env.JWT_SECRET?.trim()) missing.push('JWT_SECRET');
  if (!process.env.JWT_REFRESH_SECRET?.trim()) missing.push('JWT_REFRESH_SECRET');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

const connectPrismaWithRetry = async (prisma: { $connect: () => Promise<void> }): Promise<void> => {
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
  logStartupDiagnostics();
  try {
    validateCriticalEnv();

    const [
      { default: app },
      { default: prisma },
      { scheduleDailySync },
      _leadImportJobs,
      { verifyEmailTransport, logEmailConfigSummary },
      { startFollowUpReminders },
      { initRealtimeServer },
    ] = await Promise.all([
      import('./app'),
      import('./config/prisma'),
      import('./modules/holidays/holidays.jobs'),
      import('./modules/leads/leadImport.jobs'),
      import('./services/Email/emailService'),
      import('./services/User/followupReminder.jobs'),
      import('./realtime/socket'),
    ]);

    // Connect Redis
    await connectRedis();
    // Pass Express as the initial request listener so Engine.IO (inside Socket.IO) can wrap it.
    // Otherwise Socket.IO attaches first with zero captured listeners, and Express becomes a second
    // listener — every request runs both handlers (risky for /socket.io after Engine.IO ends the response).
    const httpServer = createServer(app);
    initRealtimeServer(httpServer);

    // Bind all interfaces — required for Render/Docker/Kubernetes
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[Server] Listening on http://0.0.0.0:${PORT} (process.env.PORT=${process.env.PORT || PORT})`);
      console.log(`[Server] NODE_ENV: ${process.env.NODE_ENV}`);
      console.log(`[Server] FRONTEND_URL: ${process.env.FRONTEND_URL || '(unset)'}`);
      console.log(`[Socket.io] Engine.IO path /socket.io on same HTTP server`);
      try {
        console.log('[CORS] Allowed origins:', getAllowedOrigins());
      } catch (e) {
        console.error('[CORS] Error getting origins:', e);
      }
    });

    try {
      logEmailConfigSummary();
    } catch {
      /* ignore */
    }

    verifyEmailTransport()
      .then(() => {
        console.log('✅ Email transport verified');
      })
      .catch((error: any) => {
        console.error('❌ Email transport failed:', error?.message || String(error));
      });

    // Connect Prisma in background so API process can still boot and avoid ERR_CONNECTION_REFUSED.
    connectPrismaWithRetry(prisma)
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
