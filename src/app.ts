import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/Auth/authRoutes';
import workspaceRoutes from './routes/Workspace/workspaceRoutes';
import adminUserRoutes from './routes/User/adminUserRoutes';
import rolesRoutes from './modules/admin/roles/roles.routes';
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
app.use('/api/admin/roles', rolesRoutes);
app.use('/api/audit', auditRoutes);

// Health check
app.get('/', (req: Request, res: Response) => {
  res.send('SEEAKK CRM Backend Running 🚀 (Prisma + PostgreSQL + Redis)');
});

// Global error handling
app.use(notFound);
app.use(errorHandler);

export default app;