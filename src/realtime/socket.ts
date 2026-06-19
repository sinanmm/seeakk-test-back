import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import prisma from '../config/prisma';
import { SOCKET_IO_PATH } from '../config/socketConstants';
import { getAllowedOrigins, isAllowedOrigin } from '../config/cors';
import { resolveWorkspaceIdForUser } from '../utils/workspaceContext';
import logger from '../utils/logger';

type RealtimeEvent =
  | 'role_updated'
  | 'permissions_updated'
  | 'user_updated'
  | 'lead_updated'
  | 'approval_updated'
  | 'report_updated'
  | 'revenue_updated'
  | 'attendance_updated';

type RealtimePayload = Record<string, unknown> & {
  workspaceId?: string;
  userIds?: string[];
};

let io: SocketIOServer | null = null;

const toWorkspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;
const toUserRoom = (userId: string) => `user:${userId}`;

const socketCorsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin || isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  logger.warn('Socket.io blocked by CORS', {
    module: 'realtime',
    origin,
    allowedOrigins: getAllowedOrigins(),
  });
  callback(new Error(`Not allowed by Socket.io CORS: ${origin}`), false);
};

/**
 * Render's edge often drops Engine.IO WebSocket upgrades; long-polling is reliable.
 * Set SOCKET_IO_ALLOW_UPGRADES=true on Render only if you have confirmed WS works for your service.
 */
const allowSocketTransportUpgrades = (): boolean => {
  if (process.env.SOCKET_IO_ALLOW_UPGRADES === 'false') return false;
  return true;
};

export const initRealtimeServer = (httpServer: HttpServer): SocketIOServer => {
  console.log('[Socket.io] initRealtimeServer called');
  console.log('[Socket.io] httpServer:', !!httpServer);

  if (io) {
    console.log('[Socket.io] Returning existing instance');
    return io;
  }

  const allowUpgrades = allowSocketTransportUpgrades();

  io = new SocketIOServer(httpServer, {
    path: SOCKET_IO_PATH,
    cors: {
      origin: socketCorsOrigin,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    allowUpgrades,
    transports: allowUpgrades ? ['polling', 'websocket'] : ['polling'],
    allowEIO3: true,
    /** Small CRM payloads: disabling permessage deflate reduces CPU on high-frequency emits (Render). */
    perMessageDeflate: false,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: 1e8,
  });
  console.log('[Socket.io] Server created successfully', {
    path: SOCKET_IO_PATH,
    allowUpgrades,
    render: process.env.RENDER === 'true',
  });
  console.log('[Socket.io] Allowed origins:', getAllowedOrigins());

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');

      if (!token) {
        return next(new Error('AUTH_ERROR: Token is missing'));
      }

      let decoded: any;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
          clockTolerance: 30,
        }) as { userId: string };
      } catch (err: any) {
        return next(new Error(`AUTH_ERROR: ${err.message || 'JWT verification failed'}`));
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, workspaceId: true, isActive: true },
      });

      if (!user) {
        return next(new Error('AUTH_ERROR: User not found'));
      }
      if (!user.isActive) {
        return next(new Error('AUTH_ERROR: User is inactive'));
      }

      const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
      if (!workspaceId) {
        return next(new Error('AUTH_ERROR: Workspace resolution failed'));
      }

      (socket.data as any).userId = user.id;
      (socket.data as any).workspaceId = workspaceId;
      socket.join(toUserRoom(user.id));
      socket.join(toWorkspaceRoom(workspaceId));
      next();
    } catch (error: any) {
      logger.error('Socket middleware unexpected error', { error: error.message });
      next(new Error(`AUTH_ERROR: ${error?.message || 'Socket authentication failed'}`));
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
