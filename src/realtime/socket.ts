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
  | 'attendance_updated'
  | 'location_updated'
  | 'location_session_started'
  | 'location_session_stopped';

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
  logger.info('Socket Error', { error: 'CORS Blocked', origin });
  callback(new Error(`Not allowed by Socket.io CORS: ${origin}`), false);
};

/**
 * Reverse proxies often drop Engine.IO WebSocket upgrades; long-polling is reliable.
 * Set SOCKET_IO_ALLOW_UPGRADES=true only after the production proxy is verified to pass Upgrade headers.
 */
const allowSocketTransportUpgrades = (): boolean => {
  return String(process.env.SOCKET_IO_ALLOW_UPGRADES || '').trim().toLowerCase() === 'true';
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
    const transport = socket.conn.transport.name;
    const socketId = socket.id;
    const query = socket.handshake.query;
    
    logger.info('Socket connection handshake attempt', {
      socketId,
      transport,
      querySid: query?.sid,
      queryEio: query?.EIO,
      action: 'socket_handshake_attempt',
    });

    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');

      if (!token) {
        logger.warn('Socket handshake rejected - Token is missing', { socketId, transport, action: 'socket_handshake_auth_failed', reason: 'token_missing' });
        return next(new Error('AUTH_ERROR: Token is missing'));
      }

      let decoded: any;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET as string, {
          clockTolerance: 30,
        }) as { userId: string };
      } catch (err: any) {
        logger.warn('Socket handshake rejected - JWT verification failed', {
          socketId,
          transport,
          error: err.message,
          action: 'socket_handshake_auth_failed',
          reason: 'jwt_verify_failed',
        });
        return next(new Error(`AUTH_ERROR: ${err.message || 'JWT verification failed'}`));
      }

      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, workspaceId: true, isActive: true },
      });

      if (!user) {
        logger.warn('Socket handshake rejected - User not found', { socketId, transport, userId: decoded.userId, action: 'socket_handshake_auth_failed', reason: 'user_not_found' });
        return next(new Error('AUTH_ERROR: User not found'));
      }
      if (!user.isActive) {
        logger.warn('Socket handshake rejected - User is inactive', { socketId, transport, userId: user.id, action: 'socket_handshake_auth_failed', reason: 'user_inactive' });
        return next(new Error('AUTH_ERROR: User is inactive'));
      }

      const workspaceId = await resolveWorkspaceIdForUser(user.id, user.workspaceId ?? null);
      if (!workspaceId) {
        logger.warn('Socket handshake rejected - Workspace resolution failed', { socketId, transport, userId: user.id, action: 'socket_handshake_auth_failed', reason: 'workspace_failed' });
        return next(new Error('AUTH_ERROR: Workspace resolution failed'));
      }

      (socket.data as any).userId = user.id;
      (socket.data as any).workspaceId = workspaceId;
      socket.join(toUserRoom(user.id));
      socket.join(toWorkspaceRoom(workspaceId));
      logger.info('Socket Handshake Completed', { userId: user.id, socketId, transport });
      next();
    } catch (error: any) {
      logger.error('Socket middleware unexpected error', { socketId, transport, error: error.message, action: 'socket_handshake_unexpected_error' });
      next(new Error(`AUTH_ERROR: ${error?.message || 'Socket authentication failed'}`));
    }
  });

  io.on('connection', (socket) => {
    const transport = socket.conn.transport.name;
    logger.info('Realtime socket connection established', {
      socketId: socket.id,
      userId: (socket.data as any)?.userId,
      workspaceId: (socket.data as any)?.workspaceId,
      transport,
      action: 'socket_connection_established',
    });

    socket.conn.on('upgrade', (upgradedTransport) => {
      logger.info('Socket transport upgraded', {
        socketId: socket.id,
        userId: (socket.data as any)?.userId,
        oldTransport: transport,
        newTransport: upgradedTransport.name,
        action: 'socket_transport_upgrade',
      });
    });
    
    socket.on('disconnect', (reason) => {
      logger.info('Socket connection disconnected', {
        socketId: socket.id,
        userId: (socket.data as any)?.userId,
        workspaceId: (socket.data as any)?.workspaceId,
        reason,
        action: 'socket_connection_disconnected',
      });
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
