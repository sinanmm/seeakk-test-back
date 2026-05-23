/**
 * Production HTTP stack (required for Socket.IO on Render):
 * - Single Node HTTP server: createServer(app)
 * - Socket.IO attaches to that server (never call app.listen() elsewhere)
 * - Listen on 0.0.0.0:PORT so Render can route traffic
 * - Engine.IO path defaults to /socket.io (see socketConstants + realtime/socket.ts)
 */
import dotenv from 'dotenv';
dotenv.config();

import dns from 'dns';
// Force IPv4 first to avoid ENETUNREACH issues on cloud providers like Render
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

import { createServer } from 'http';
import { connectRedis } from './config/redis';
import { getAllowedOrigins } from './config/cors';
import { logStartupDiagnostics } from './config/startupDiagnostics';
import { buildSmtpAuthFailureHint } from './config/emailSmtpHints';

const PORT = Number.parseInt(String(process.env.PORT || '5000'), 10) || 5000;

const shouldSkipEmailVerifyAtStartup = (): boolean => {
  const v = String(process.env.EMAIL_SKIP_VERIFY || '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
};

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
      _leadImportJobs,
      { verifyEmailTransport, logEmailConfigSummary },
      { startFollowUpReminders },
      { initRealtimeServer },
      { startAttendanceJobs },
      { startTargetPerformanceJobs },
    ] = await Promise.all([
      import('./app'),
      import('./config/prisma'),
      import('./modules/leads/leadImport.jobs'),
      import('./services/Email/emailService'),
      import('./services/User/followupReminder.jobs'),
      import('./realtime/socket'),
      import('./modules/attendance/attendance.jobs'),
      import('./modules/targets/targetCron.jobs'),
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

    if (shouldSkipEmailVerifyAtStartup()) {
      console.warn(
        '[Email] EMAIL_SKIP_VERIFY is set — skipping SMTP verify at startup. Mail sends will still use EMAIL_USER / EMAIL_PASS.',
      );
    } else {
      verifyEmailTransport()
        .then(() => {
          console.log('✅ Email transport verified');
        })
        .catch((error: any) => {
          console.error('❌ Email transport failed:', error?.message || String(error));
          console.error('[Email] Hint:', buildSmtpAuthFailureHint(error));
        });
    }

    // Connect Prisma in background so API process can still boot and avoid ERR_CONNECTION_REFUSED.
    connectPrismaWithRetry(prisma)
      .then(async () => {
        console.log('PostgreSQL connected via Prisma');
        try {
          const { ensureReportTypeSchemaColumns } = await import('./modules/reports/reportTypeSchemaGuard');
          await ensureReportTypeSchemaColumns();
          console.log('[Reports] report_types schema columns verified');
        } catch (schemaError) {
          console.error('[Reports] Failed to ensure report_types columns:', schemaError);
        }
        try {
          const { ensureWeeklyOffSchema } = await import('./modules/holidays/weeklyOffSchemaGuard');
          await ensureWeeklyOffSchema();
        } catch (schemaError) {
          console.error('[Holidays] Failed to ensure weekly-off schema:', schemaError);
        }
        try {
          const { ensureAttendancePermissionsSeeded } = await import('./modules/attendance/attendancePermissionsGuard');
          await ensureAttendancePermissionsSeeded();
        } catch (guardError) {
          console.error('[Guard] Failed to run attendance permissions guard:', guardError);
        }
        // Start background jobs
        startFollowUpReminders();
        startAttendanceJobs();
        startTargetPerformanceJobs();
      })
      .catch((error) => {
        console.error('PostgreSQL initial connection failed. API is running in degraded mode:', error);
      });

    // Graceful Shutdown Handler
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
      
      try {
        const { disconnectRedis } = await import('./config/redis');
        const { closeBullMQConnections } = await import('./config/bullmq');
        
        // 1. Stop accepting new HTTP requests
        httpServer.close(() => {
          console.log('[Server] HTTP server closed');
        });

        // 2. Close BullMQ connections
        await closeBullMQConnections();
        
        // 3. Disconnect Redis
        await disconnectRedis();

        // 4. Disconnect Prisma
        await prisma.$disconnect();
        console.log('[Prisma] Database disconnected');

        console.log('[Server] Shutdown complete. Goodbye!');
        process.exit(0);
      } catch (err) {
        console.error('[Server] Error during shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
