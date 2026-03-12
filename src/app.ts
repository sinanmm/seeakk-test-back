import express, { Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import authRoutes from './routes/Auth/authRoutes';
import workspaceRoutes from './routes/Workspace/workspaceRoutes';
import logger from './utils/logger';
import { globalLimiter } from './middlewares/rateLimiter';
import { notFound, errorHandler } from './middlewares/errorMiddleware';

const app = express();

// middleware
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));
app.use(cors());
app.use(express.json());

// Apply global rate limiting to strictly restrict standard DDOS flooding
// Protects everything mapped under /api route endpoints.
app.use('/api/', globalLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/workspace', workspaceRoutes);

// test route
app.get('/', (req: Request, res: Response) => {
  res.send('SEEAKK CRM Backend Running 🚀');
});

// System global error handling boundary
app.use(notFound);
app.use(errorHandler);

export default app;