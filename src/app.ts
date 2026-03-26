import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/Auth/authRoutes';
import workspaceRoutes from './routes/Workspace/workspaceRoutes';
import adminUserRoutes from './routes/User/adminUserRoutes';
import officeRoutes from './routes/User/officeRoutes';
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
import leadStageRoutes from './modules/master/lead-stages/leadStage.routes';
import stageRuleRoutes from './modules/master/stage-rules/stageRule.routes';
import auditRoutes from './routes/Audit/auditRoutes';
import logger from './utils/logger';
import { globalLimiter } from './middlewares/rateLimiter';
import { notFound, errorHandler } from './middlewares/errorMiddleware';

const app = express();


// Middleware
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));
app.use(cors());
app.use(express.json());

// Global rate limiting
app.use('/api/', globalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/admin/offices', officeRoutes);
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
app.use('/api/master/lead-stages', leadStageRoutes);
app.use('/api/master/stage-rules', stageRuleRoutes);
app.use('/api/audit', auditRoutes);

// Health check
app.get('/', (req: Request, res: Response) => {
  res.send('SEEAKK CRM Backend Running 🚀 (Prisma + PostgreSQL + Redis)');
});

// Global error handling
app.use(notFound);
app.use(errorHandler);

export default app;
