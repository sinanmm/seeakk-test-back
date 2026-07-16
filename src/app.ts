import { randomUUID } from 'crypto';
import express, { Request, Response } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/Auth/authRoutes';
import workspaceRoutes from './routes/Workspace/workspaceRoutes';
import adminUserRoutes from './routes/User/adminUserRoutes';
import officeRoutes from './routes/User/officeRoutes';
import leadLifeCycleRoutes from './routes/User/leadLifeCycleRoutes';
import followupRoutes from './routes/User/followupRoutes';
import leadRoutes from './routes/User/leadRoutes';
import paymentRoutes from './routes/User/paymentRoutes';
import closedLeadsRoutes from './modules/leads/leads.routes';
import bulkAssignRoutes from './modules/leads/bulkAssign.routes';
import leadApprovalsRoutes from './modules/leads/leadApprovals.routes';
import lobAnalysisRoutes from './modules/leads/lobAnalysis.routes';
import leadImportRoutes from './modules/leads/leadImport.routes';
import rolesRoutes from './modules/admin/roles/roles.routes';
import departmentsRoutes from './modules/admin/departments/departments.routes';
import organisationChartRoutes from './modules/admin/organisation-chart/organisationChart.routes';
import rosterRoutes from './modules/admin/roster/roster.routes';
import targetCycleRoutes from './modules/admin/targetCycle/targetCycle.routes';
import targetRoutes from './modules/targets/target.routes';
import {
  leadDynamicsAdminRoutes,
  leadDynamicsRouter,
  leadValuesRouter,
} from './modules/admin/lead-dynamics/leadDynamics.routes';
import { fieldHighlightRoutes } from './modules/admin/field-highlights/fieldHighlights.routes';
import leadSourceRoutes from './modules/master/lead-source/leadSource.routes';
import productRoutes from './modules/master/products/product.routes';

import leadStageRoutes from './modules/master/lead-stages/leadStage.routes';
import lobReasonRoutes from './modules/master/lob-reasons/lobReasons.routes';
import followupExtensionReasonRoutes from './modules/master/followup-extension-reasons/followUpExtensionReasons.routes';
import followupSettingsRoutes from './modules/followup-settings/followupSettings.routes';
import stageRuleRoutes from './modules/master/stage-rules/stageRule.routes';
import auditRoutes from './routes/Audit/auditRoutes';
import holidayRoutes from './modules/holidays/holidays.routes';
import reportTypeRoutes from './modules/reports/reportTypes.routes';
import reportRoutes from './modules/reports/reports.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import attendanceRoutes from './modules/attendance/attendance.routes';
import locationTrackingRoutes from './modules/location-tracking/locationTracking.routes';
import logger from './utils/logger';
import prisma from './config/prisma';
import { redisClient } from './config/redis';
import { SOCKET_IO_PATH } from './config/socketConstants';
import {
  CORS_ALLOWED_HEADERS,
  corsOriginHandler,
  ensureCorsHeadersMiddleware,
  handlePreflightRequest,
  requestTimeoutMiddleware,
} from './config/cors';
import { globalLimiter } from './middlewares/rateLimiter';
import { notFound, errorHandler } from './middlewares/errorMiddleware';
import { FOLLOWUP_LOCK_BYPASS_VERSION } from './utils/followUpLockExemptPaths';

const app = express();
// Render / Vercel / proxies: trust X-Forwarded-* for correct req.ip and secure cookies if used later
app.set('trust proxy', 1);

console.log('Application Started');

const corsOptions: cors.CorsOptions = {
  origin: corsOriginHandler,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: CORS_ALLOWED_HEADERS.split(',').map((header) => header.trim()),
  exposedHeaders: ['Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Add diagnostic log for OPTIONS
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    logger.info('OPTIONS Request Received', { path: req.path, origin: req.headers.origin });
    res.on('finish', () => {
      logger.info('OPTIONS Response Sent', { path: req.path, statusCode: res.statusCode });
    });
  }
  next();
});

// Production-grade CORS config FIRST
app.use(cors(corsOptions));

app.use(ensureCorsHeadersMiddleware);
app.use(handlePreflightRequest);

console.log('CORS Initialized');

app.use(cookieParser());

const shouldCompress = (req: Request): boolean => {
  const p = req.path || '';
  return p !== SOCKET_IO_PATH && !p.startsWith(`${SOCKET_IO_PATH}/`);
};

app.use(
  compression({
    threshold: 1024,
    filter: (req, res) => {
      if (!shouldCompress(req)) return false;
      return compression.filter(req, res);
    },
  }),
);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '5mb';

// Preflight must succeed before auth / rate-limit / route handlers (fixes Vercel CORS on meta APIs).
// CORS is now handled at the very top of the file
app.use(requestTimeoutMiddleware);

// Access logs: "tiny" in production reduces log volume unless ACCESS_LOG_VERBOSE=true
const accessLogFormat =
  process.env.NODE_ENV === 'production' && process.env.ACCESS_LOG_VERBOSE !== 'true' ? 'tiny' : 'combined';
app.use(morgan(accessLogFormat, { stream: { write: (message: string) => logger.info(message.trim()) } }));

// Production-grade CORS config (moved to top of file)

// Correlation id for support / log cross-reference (idempotent if client sends X-Request-Id)
app.use((req, res, next) => {
  const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
  const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  (req as Request & { id?: string }).id = id;
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  const origin = req.headers.origin as string | undefined;
  const requestId = (req as Request & { id?: string }).id || req.headers['x-request-id'];
  const isDashboard = req.path.startsWith('/api/dashboard');
  const isCorsBrowserRequest = Boolean(origin);

  if (!isDashboard && !isCorsBrowserRequest) {
    return next();
  }

  res.on('finish', () => {
    logger.info(isDashboard ? 'Dashboard request completed' : 'CORS browser request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      origin,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      corsOrigin: res.getHeader('Access-Control-Allow-Origin') || null,
    });
  });

  return next();
});

app.use((req, res, next) => {
  if (req.path === SOCKET_IO_PATH || req.path.startsWith(`${SOCKET_IO_PATH}/`)) {
    return next();
  }
  return express.json({ limit: requestBodyLimit })(req, res, next);
});

app.use((req, res, next) => {
  if (req.path === SOCKET_IO_PATH || req.path.startsWith(`${SOCKET_IO_PATH}/`)) {
    return next();
  }
  return express.urlencoded({ extended: true, limit: requestBodyLimit })(req, res, next);
});

// Security Headers for Google OAuth
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// Liveness: no DB — for load balancers & browser checks (must stay fast)
app.get('/healthz', (_req, res) => {
  logger.info('Health Endpoint Accessed');
  res.status(200).json({
    ok: true,
    uptime: process.uptime(),
    timestamp: Date.now(),
    followUpLockBypassVersion: FOLLOWUP_LOCK_BYPASS_VERSION,
    buildCommit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
  });
});

app.get('/socket-test', (_req, res) => {
  res.status(200).json({
    socketio: 'Check /socket.io/ path directly',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check
app.get(['/readyz', '/health'], async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisReady = redisClient.isOpen;
    res.status(200).json({
      database: 'ok',
      socket: 'ok',
      storage: 'ok',
      redis: redisReady ? 'ok' : 'down',
      uptime: process.uptime(),
      version: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '1.0.0',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      database: 'down',
      socket: 'ok', // Assuming socket doesn't rely purely on DB for health check
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
});

// REST API: prevent shared caches from storing authenticated JSON (privacy + correctness)
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store, must-revalidate');
  next();
});

// Global rate limiting
app.use('/api/', globalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/offices', officeRoutes);
app.use('/api/admin/lead-life-cycles', leadLifeCycleRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/leads', closedLeadsRoutes);
app.use('/api/leads', bulkAssignRoutes);
app.use('/api/leads', leadImportRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/leads', paymentRoutes);
app.use('/api/approvals', leadApprovalsRoutes);
app.use('/api/lob-analysis', lobAnalysisRoutes);
app.use('/api/admin/roles', rolesRoutes);
app.use('/api/admin/departments', departmentsRoutes);
app.use('/api/admin/organisation-chart', organisationChartRoutes);
app.use('/api/admin/organization-chart', organisationChartRoutes);
app.use('/api/admin/roster', rosterRoutes);
app.use('/api/admin/target-cycles', targetCycleRoutes);
app.use('/api/targets', targetRoutes);
app.use('/api/admin/lead-dynamics', leadDynamicsAdminRoutes);
app.use('/api/master/target-cycles', targetCycleRoutes);
app.use('/api/admin/field-highlights', fieldHighlightRoutes);
app.use('/api/lead-dynamics', leadDynamicsRouter);
app.use('/api/leads', leadValuesRouter);
app.use('/api/master/lead-sources', leadSourceRoutes);
app.use('/api/master/products', productRoutes);

app.use('/api/master/lead-stages', leadStageRoutes);
app.use('/api/lob-reasons', lobReasonRoutes);
app.use('/api/followup-extension-reasons', followupExtensionReasonRoutes);
app.use('/api/followup-settings', followupSettingsRoutes);
app.use('/api/master/stage-rules', stageRuleRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/report-types', reportTypeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/location-tracking', locationTrackingRoutes);

// Health check
app.get('/', (req: Request, res: Response) => {
  res.send('SEEAKK CRM Backend Running 🚀 (Prisma + PostgreSQL + Redis)');
});

// Global error handling
app.use((req, res, next) => {
  // Never 404 on Engine.IO paths — Socket.IO handles these on the same Node HTTP server
  if (req.path === SOCKET_IO_PATH || req.path.startsWith(`${SOCKET_IO_PATH}/`)) return next();
  notFound(req, res, next);
});
app.use(errorHandler);


export default app;
