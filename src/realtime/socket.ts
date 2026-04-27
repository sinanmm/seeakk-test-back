import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import prisma from '../config/prisma';
import logger from '../utils/logger';

type RealtimeEvent =
  | 'role_updated'
  | 'permissions_updated'
  | 'user_updated'
  | 'lead_updated'
  | 'report_updated';

type RealtimePayload = Record<string, unknown> & {
  workspaceId?: string;
  userIds?: string[];
};

let io: SocketIOServer | null = null;

const normalizeOrigin = (origin: string): string => origin.trim().replace(/\/+$/, '');
const splitOriginList = (raw?: string | null): string[] =>
  (raw || '')
    .split(/[\s,]+/)
    .map((item) => normalizeOrigin(item))
    .filter((item) => item.length > 0);

const allowVercelApp =
  String(process.env.CORS_ALLOW_VERCEL_APP ?? 'true').toLowerCase() !== 'false';

const allowedOrigins = new Set<string>([
  ...splitOriginList(process.env.FRONTEND_URL),
  ...splitOriginList(process.env.ALLOWED_ORIGINS),
  'https://lms-frontend-amber-beta.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const isAllowedOrigin = (origin: string): boolean => allowedOrigins.has(normalizeOrigin(origin));
const isVercelAppOrigin = (origin: string): boolean => {
  if (!allowVercelApp) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && hostname.endsWith('.vercel.app') && hostname.length > '.vercel.app'.length;
  } catch {
    return false;
  }
};

const toWorkspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;
const toUserRoom = (userId: string) => `user:${userId}`;

export const initRealtimeServer = (httpServer: HttpServer): SocketIOServer => {
  if (io) return io;

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (isAllowedOrigin(origin) || isVercelAppOrigin(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('Socket CORS origin blocked'));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');

      if (!token) return next(new Error('Unauthorized socket connection'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string };
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, workspaceId: true, isActive: true },
      });

      if (!user || !user.isActive || !user.workspaceId) {
        return next(new Error('Unauthorized socket connection'));
      }

      (socket.data as any).userId = user.id;
      (socket.data as any).workspaceId = user.workspaceId;
      socket.join(toUserRoom(user.id));
      socket.join(toWorkspaceRoom(user.workspaceId));
      next();
    } catch (error: any) {
      next(new Error(error?.message || 'Socket authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Realtime socket connected', {
      socketId: socket.id,
      userId: (socket.data as any)?.userId,
      workspaceId: (socket.data as any)?.workspaceId,
    });
  });

  return io;
};

export const emitWorkspaceEvent = (
  workspaceId: string,
  event: RealtimeEvent,
  payload: RealtimePayload = {},
): void => {
  if (!io) return;
  io.to(toWorkspaceRoom(workspaceId)).emit(event, {
    ...payload,
    workspaceId,
    event,
    emittedAt: new Date().toISOString(),
  });
};

export const emitUserEvent = (
  userId: string,
  event: RealtimeEvent,
  payload: RealtimePayload = {},
): void => {
  if (!io) return;
  io.to(toUserRoom(userId)).emit(event, {
    ...payload,
    userIds: [userId],
    event,
    emittedAt: new Date().toISOString(),
  });
};

export const emitUsersEvent = (
  userIds: string[],
  event: RealtimeEvent,
  payload: RealtimePayload = {},
): void => {
  if (!io || userIds.length === 0) return;
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  uniqueIds.forEach((userId) => emitUserEvent(userId, event, payload));
};
