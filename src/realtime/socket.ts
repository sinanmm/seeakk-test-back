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

const toWorkspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;
const toUserRoom = (userId: string) => `user:${userId}`;

export const initRealtimeServer = (httpServer: HttpServer): SocketIOServer => {
  console.log('[Socket.io] initRealtimeServer called');
  console.log('[Socket.io] httpServer:', !!httpServer);

  if (io) {
    console.log('[Socket.io] Returning existing instance');
    return io;
  }

  const allowedOrigins = [
    'https://lms-frontend-amber-beta.vercel.app',
    process.env.FRONTEND_URL,
    process.env.ALLOWED_ORIGINS,
    'http://localhost:5173',
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  console.log('[Socket.io] Allowed origins:', allowedOrigins);

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-device-id',
      ],
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000,
  });
  console.log('[Socket.io] Server created successfully');
  console.log('[Socket.io] Origins:', [
    'https://lms-frontend-amber-beta.vercel.app',
    process.env.FRONTEND_URL,
    process.env.ALLOWED_ORIGINS,
  ].filter(Boolean));

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
