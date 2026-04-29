import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/Auth/authRoutes';
import workspaceRoutes from './routes/Workspace/workspaceRoutes';
import adminUserRoutes from './routes/User/adminUserRoutes';
import officeRoutes from './routes/User/officeRoutes';
import leadLifeCycleRoutes from './routes/User/leadLifeCycleRoutes';
import followupRoutes from './routes/User/followupRoutes';
import leadRoutes from './routes/User/leadRoutes';
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
import {
  leadDynamicsAdminRoutes,
  leadDynamicsRouter,
  leadValuesRouter,
} from './modules/admin/lead-dynamics/leadDynamics.routes';
import leadSourceRoutes from './modules/master/lead-source/leadSource.routes';
import locationRoutes from './modules/master/locations/locations.routes';
import leadStageRoutes from './modules/master/lead-stages/leadStage.routes';
import lobReasonRoutes from './modules/master/lob-reasons/lobReasons.routes';
import stageRuleRoutes from './modules/master/stage-rules/stageRule.routes';
import auditRoutes from './routes/Audit/auditRoutes';
import holidayRoutes from './modules/holidays/holidays.routes';
import reportTypeRoutes from './modules/reports/reportTypes.routes';
import reportRoutes from './modules/reports/reports.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import logger from './utils/logger';
import prisma from './config/prisma';
import { redisClient } from './config/redis';
import { corsOriginHandler, isAllowedOrigin } from './config/cors';
import { globalLimiter } from './middlewares/rateLimiter';
import { notFound, errorHandler } from './middlewares/errorMiddleware';

const app = express();
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || '5mb';

const corsOptions: cors.CorsOptions = {
  origin: corsOriginHandler,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-device-id',
    'x-request-id',
    'x-workspace-id',
    'Accept',
    'Origin',
    'X-Requested-With',
  ],
  exposedHeaders: ['Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
};

// Middleware
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));

// Ensure allowed origins always receive CORS headers even on fast-fail/error paths.
app.use((req: Request, res: Response, next) => {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-device-id, x-request-id, x-workspace-id, Accept, Origin, X-Requested-With',
    );
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Expose-Headers', 'Authorization');
  }
  next();
});

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));

// Security Headers for Google OAuth
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// Simple health check
app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/socket-test', (_req, res) => {
  res.status(200).json({
    socketio: 'Check /socket.io/ path directly',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check
app.get('/readyz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const redisReady = redisClient.isOpen;
    res.status(200).json({
      ok: true,
      db: true,
      redis: redisReady,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      db: false,
      timestamp: new Date().toISOString(),
    });
  }
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
app.use('/api/approvals', leadApprovalsRoutes);
app.use('/api/lob-analysis', lobAnalysisRoutes);
app.use('/api/admin/roles', rolesRoutes);
app.use('/api/admin/departments', departmentsRoutes);
app.use('/api/admin/organisation-chart', organisationChartRoutes);
app.use('/api/admin/organization-chart', organisationChartRoutes);
app.use('/api/admin/roster', rosterRoutes);
app.use('/api/admin/target-cycles', targetCycleRoutes);
app.use('/api/admin/lead-dynamics', leadDynamicsAdminRoutes);
app.use('/api/master/target-cycles', targetCycleRoutes);
app.use('/api/lead-dynamics', leadDynamicsRouter);
app.use('/api/leads', leadValuesRouter);
app.use('/api/master/lead-sources', leadSourceRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/master/lead-stages', leadStageRoutes);
app.use('/api/lob-reasons', lobReasonRoutes);
app.use('/api/master/stage-rules', stageRuleRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/report-types', reportTypeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Health check
app.get('/', (req: Request, res: Response) => {
  res.send('SEEAKK CRM Backend Running 🚀 (Prisma + PostgreSQL + Redis)');
});

// Global error handling
app.use(notFound);
app.use(errorHandler);

export default app;
