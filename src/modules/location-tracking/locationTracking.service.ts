import prisma from '../../config/prisma';
import { hasPermission } from '../../middlewares/authMiddleware';
import { emitWorkspaceEvent } from '../../realtime/socket';
import type { PushLocationInput, RouteQueryInput, StartSessionInput, StopSessionInput } from './locationTracking.validation';
import { recalculateStops } from './recalculateStops';

const FIELD_TRACKING_TERMS = [
  'field',
  'sales',
  'executive',
  'bde',
  'marketing',
  'staff',
  'admin',
  'manager',
  'superadmin',
  'head',
  'officer',
  'representative',
  'intern',
];
const OFFLINE_AFTER_MS = 2 * 60 * 1000;
const STOP_RADIUS_METERS = 30;
const STOP_MIN_SECONDS = 5 * 60;

const createError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

const dayRange = (input?: Date) => {
  const base = input ? new Date(input) : new Date();
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const routeRange = (query: RouteQueryInput) => {
  if (query.startDate || query.endDate) {
    const start = query.startDate ? new Date(query.startDate) : dayRange(query.date).start;
    const end = query.endDate ? new Date(query.endDate) : dayRange(query.date).end;
    return { start, end };
  }
  return dayRange(query.date);
};

const radians = (deg: number) => (deg * Math.PI) / 180;

export const distanceMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const earthRadius = 6371000;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const isFieldTrackingCandidate = (user: any) => {
  if (!user) return false;
  const haystack = [user.role?.name, user.designation, user.department?.name, user.role]
    .filter(Boolean)
    .map((val) => (typeof val === 'string' ? val : val?.name || ''))
    .join(' ')
    .toLowerCase();
  if (!haystack || haystack.trim().length === 0) return true;
  return FIELD_TRACKING_TERMS.some((term) => haystack.includes(term));
};

const viewerScope = async (workspaceId: string, actor: any) => {
  const canViewAll =
    (await hasPermission(actor, 'LOCATION_TRACKING_VIEW_ALL')) ||
    (await hasPermission(actor, 'SYSTEM_CONFIG')) ||
    (await hasPermission(actor, 'view_all_attendance'));
  if (canViewAll) return 'ALL' as const;

  const canViewAssigned =
    (await hasPermission(actor, 'LOCATION_TRACKING_VIEW_ASSIGNED')) ||
    (await hasPermission(actor, 'LOCATION_TRACKING_VIEW_LIVE'));
  if (!canViewAssigned) {
    throw createError('You do not have permission to view location tracking.', 403);
  }

  const directReports = await prisma.user.findMany({
    where: { workspaceId, supervisorId: actor.id, deletedAt: null },
    select: { id: true },
  });
  return directReports.map((user) => user.id);
};

const ensureUserVisible = async (workspaceId: string, actor: any, targetUserId: string) => {
  if (actor.id === targetUserId) return;
  const scope = await viewerScope(workspaceId, actor);
  if (scope === 'ALL') return;
  if (!scope.includes(targetUserId)) {
    throw createError('You are not allowed to view this user location.', 403);
  }
};

const userWhereForScope = async (workspaceId: string, actor: any) => {
  const scope = await viewerScope(workspaceId, actor);
  return {
    workspaceId,
    deletedAt: null,
    isActive: true,
    ...(scope === 'ALL' ? {} : { id: { in: scope } }),
  };
};

const activeAttendanceForUser = async (workspaceId: string, userId: string, attendanceRecordId?: string) => {
  if (attendanceRecordId) {
    const specificRecord = await (prisma as any).attendanceRecord.findFirst({
      where: {
        id: attendanceRecordId,
        workspaceId,
        userId,
        checkInTime: { not: null },
        checkoutCompleted: false,
        checkOutTime: null,
      },
    });
    if (specificRecord) return specificRecord;
  }

  return (prisma as any).attendanceRecord.findFirst({
    where: {
      workspaceId,
      userId,
      checkInTime: { not: null },
      checkoutCompleted: false,
      checkOutTime: null,
    },
    orderBy: { checkInTime: 'desc' },
  });
};

export const shouldTrackUserLocation = async (workspaceId: string, userId: string) => {
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null, isActive: true },
    include: { role: true, department: true },
  });
  if (!user) return false;
  return isFieldTrackingCandidate(user);
};

export const startSessionForAttendance = async (
  workspaceId: string,
  userId: string,
  attendanceRecordId: string,
  deviceType?: string | null,
) => {
  if (!(await shouldTrackUserLocation(workspaceId, userId))) return null;

  const existing = await (prisma as any).locationSession.findFirst({
    where: { workspaceId, userId, attendanceRecordId, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (existing) {
    return existing;
  }

  const session = await (prisma as any).locationSession.create({
    data: {
      workspaceId,
      userId,
      attendanceRecordId,
      startedBy: userId,
      deviceType: deviceType || 'web',
      status: 'ACTIVE',
    },
  });

  await (prisma as any).attendanceAuditLog.create({
    data: {
      workspaceId,
      userId,
      action: 'LOCATION_TRACKING_STARTED',
      details: JSON.stringify({ module: 'location_tracking', attendanceRecordId, sessionId: session.id }),
    },
  });

  emitWorkspaceEvent(workspaceId, 'location_session_started' as any, { userId, sessionId: session.id, attendanceRecordId });
  return session;
};

export const stopSessionForAttendance = async (
  workspaceId: string,
  userId: string,
  attendanceRecordId: string,
  actorId = userId,
) => {
  const sessions = await (prisma as any).locationSession.findMany({
    where: { workspaceId, userId, attendanceRecordId, status: 'ACTIVE' },
  });
  if (sessions.length === 0) return null;

  const stoppedAt = new Date();
  const updated = await Promise.all(
    sessions.map((session: any) =>
      (prisma as any).locationSession.update({
        where: { id: session.id },
        data: { status: 'STOPPED', stoppedAt, stoppedBy: actorId },
      }),
    ),
  );

  await (prisma as any).attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actorId,
      action: 'LOCATION_TRACKING_STOPPED',
      details: JSON.stringify({
        module: 'location_tracking',
        attendanceRecordId,
        sessionIds: updated.map((session) => session.id),
      }),
    },
  });

  emitWorkspaceEvent(workspaceId, 'location_session_stopped' as any, { userId, attendanceRecordId });
  return updated[0];
};

export const startSession = async (workspaceId: string, actor: any, input: StartSessionInput) => {
  const attendance = await activeAttendanceForUser(workspaceId, actor.id, input.attendanceRecordId);
  if (!attendance) {
    throw createError('Check-in is required before location tracking can start.', 409);
  }
  const session = await startSessionForAttendance(workspaceId, actor.id, attendance.id, input.deviceType);
  if (!session) throw createError('Location tracking is not enabled for this user role.', 403);
  return session;
};

export const stopSession = async (workspaceId: string, actor: any, input: StopSessionInput) => {
  const where: any = input.sessionId
    ? { id: input.sessionId, workspaceId, userId: actor.id, status: 'ACTIVE' }
    : { workspaceId, userId: actor.id, attendanceRecordId: input.attendanceRecordId, status: 'ACTIVE' };
  const session = await (prisma as any).locationSession.findFirst({ where });
  if (!session) return null;
  return stopSessionForAttendance(workspaceId, actor.id, session.attendanceRecordId, actor.id);
};

const resolveActiveSessionForPoint = async (workspaceId: string, userId: string, input: PushLocationInput) => {
  if (input.sessionId) {
    const session = await (prisma as any).locationSession.findFirst({
      where: { id: input.sessionId, workspaceId, userId, status: 'ACTIVE' },
    });
    if (session) return session;
  }

  const attendance = await activeAttendanceForUser(workspaceId, userId, input.attendanceRecordId);
  if (!attendance) {
    throw createError('Active attendance check-in is required before uploading locations.', 409);
  }

  const existing = await (prisma as any).locationSession.findFirst({
    where: { workspaceId, userId, attendanceRecordId: attendance.id, status: 'ACTIVE' },
    orderBy: { startedAt: 'desc' },
  });
  if (existing) return existing;
  return startSessionForAttendance(workspaceId, userId, attendance.id, input.points[0]?.deviceType || 'web');
};

export const pushLocation = async (workspaceId: string, actor: any, input: PushLocationInput) => {
  if (!(await shouldTrackUserLocation(workspaceId, actor.id))) {
    throw createError('Location tracking is not enabled for this user role.', 403);
  }

  const session = await resolveActiveSessionForPoint(workspaceId, actor.id, input);
  if (!session) throw createError('Unable to start location session.', 409);

  const points = await (prisma as any).$transaction(
    input.points.map((point) =>
      (prisma as any).locationPoint.create({
        data: {
          workspaceId,
          userId: actor.id,
          sessionId: session.id,
          attendanceRecordId: session.attendanceRecordId,
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy ?? null,
          speed: point.speed ?? null,
          heading: point.heading ?? null,
          batteryPercentage: point.batteryPercentage ?? null,
          recordedAt: point.recordedAt,
          deviceType: point.deviceType || session.deviceType || 'web',
          source: point.source || 'web',
        },
      }),
    ),
  );

  const latest = points[points.length - 1];
  if (latest) {
    await (prisma as any).locationSession.update({
      where: { id: session.id },
      data: {
        lastLatitude: latest.latitude,
        lastLongitude: latest.longitude,
        lastAccuracy: latest.accuracy,
        lastSpeed: latest.speed,
        lastHeading: latest.heading,
        lastBattery: latest.batteryPercentage,
        lastUpdatedAt: latest.recordedAt,
      },
    });

    emitWorkspaceEvent(workspaceId, 'location_updated' as any, {
      userId: actor.id,
      sessionId: session.id,
      point: latest,
    });
  }

  await (prisma as any).attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actor.id,
      action: 'LOCATION_UPLOADED',
      details: JSON.stringify({ module: 'location_tracking', sessionId: session.id, count: points.length }),
    },
  });

  // Smart Stop Detection asynchronously
  recalculateStops(session.id, workspaceId, actor.id).catch((err) => {
    console.error(`Failed to recalculate stops for session ${session.id}:`, err.message);
  });

  return { sessionId: session.id, uploaded: points.length, latest };
};

const movementStatus = (session: any) => {
  if (!session?.lastUpdatedAt) return 'Offline';
  if (Date.now() - new Date(session.lastUpdatedAt).getTime() > OFFLINE_AFTER_MS) return 'Offline';
  const speed = Number(session.lastSpeed || 0);
  return speed >= 0.8 ? 'Moving' : 'Stopped';
};

export const getLiveLocations = async (workspaceId: string, actor: any, userId?: string) => {
  if (userId) await ensureUserVisible(workspaceId, actor, userId);
  const where = userId ? { workspaceId, id: userId, deletedAt: null } : await userWhereForScope(workspaceId, actor);

  const users = await prisma.user.findMany({
    where,
    include: { role: true, department: true, office: true },
    orderBy: { name: 'asc' },
  });

  const fieldUsers = users.filter(isFieldTrackingCandidate);
  const sessions = await (prisma as any).locationSession.findMany({
    where: { workspaceId, userId: { in: fieldUsers.map((u) => u.id) } },
    orderBy: { startedAt: 'desc' },
  });
  const latestByUser = new Map<string, any>();
  sessions.forEach((session: any) => {
    if (!latestByUser.has(session.userId)) latestByUser.set(session.userId, session);
  });

  return fieldUsers.map((user: any) => {
    const session = latestByUser.get(user.id);
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        employeeId: user.employeeId || null,
        avatarUrl: user.avatarUrl || user.profileImageUrl || null,
        role: user.role?.name || null,
        department: user.department?.name || null,
        office: user.office?.name || null,
      },
      sessionId: session?.id || null,
      attendanceRecordId: session?.attendanceRecordId || null,
      latitude: session?.lastLatitude ?? null,
      longitude: session?.lastLongitude ?? null,
      accuracy: session?.lastAccuracy ?? null,
      speed: session?.lastSpeed ?? null,
      heading: session?.lastHeading ?? null,
      batteryPercentage: session?.lastBattery ?? null,
      lastUpdatedAt: session?.lastUpdatedAt ?? null,
      status: movementStatus(session),
      trackingStatus: session?.status || 'INACTIVE',
    };
  });
};

const summarizePoints = (points: any[]) => {
  let totalDistanceMeters = 0;
  let movingSeconds = 0;
  let stopSeconds = 0;
  let maxSpeed = 0;
  let speedSamples = 0;
  let speedTotal = 0;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const seconds = Math.max(0, (new Date(current.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 1000);
    const distance = distanceMeters(prev, current);
    totalDistanceMeters += distance;
    const speed = current.speed ?? (seconds > 0 ? distance / seconds : 0);
    if (speed >= 0.8 || distance > STOP_RADIUS_METERS) movingSeconds += seconds;
    else stopSeconds += seconds;
    maxSpeed = Math.max(maxSpeed, speed);
    speedTotal += speed;
    speedSamples += 1;
  }

  return {
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalDistanceKm: Number((totalDistanceMeters / 1000).toFixed(2)),
    movingSeconds: Math.round(movingSeconds),
    stopSeconds: Math.round(stopSeconds),
    averageSpeedKmh: speedSamples ? Number(((speedTotal / speedSamples) * 3.6).toFixed(1)) : 0,
    maxSpeedKmh: Number((maxSpeed * 3.6).toFixed(1)),
  };
};

const detectStops = (points: any[]) => {
  const stops: any[] = [];
  let anchor: any | null = null;
  let cluster: any[] = [];

  points.forEach((point) => {
    if (!anchor) {
      anchor = point;
      cluster = [point];
      return;
    }
    if (distanceMeters(anchor, point) <= STOP_RADIUS_METERS) {
      cluster.push(point);
      return;
    }
    const durationSeconds =
      cluster.length > 1
        ? Math.round((new Date(cluster[cluster.length - 1].recordedAt).getTime() - new Date(cluster[0].recordedAt).getTime()) / 1000)
        : 0;
    if (durationSeconds >= STOP_MIN_SECONDS) {
      stops.push({
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        startedAt: cluster[0].recordedAt,
        endedAt: cluster[cluster.length - 1].recordedAt,
        durationSeconds,
      });
    }
    anchor = point;
    cluster = [point];
  });

  return stops;
};

export const getRoute = async (workspaceId: string, actor: any, query: RouteQueryInput) => {
  await ensureUserVisible(workspaceId, actor, query.userId);
  const range = routeRange(query);
  const [points, sessions, stops] = await Promise.all([
    (prisma as any).locationPoint.findMany({
      where: {
        workspaceId,
        userId: query.userId,
        recordedAt: { gte: range.start, lte: range.end },
      },
      orderBy: { recordedAt: 'asc' },
    }),
    (prisma as any).locationSession.findMany({
      where: {
        workspaceId,
        userId: query.userId,
        startedAt: { lte: range.end },
        OR: [{ stoppedAt: null }, { stoppedAt: { gte: range.start } }],
      },
      orderBy: { startedAt: 'asc' },
    }),
    (prisma as any).locationStop.findMany({
      where: {
        workspaceId,
        userId: query.userId,
        startedAt: { gte: range.start, lte: range.end },
      },
      orderBy: { startedAt: 'asc' },
    }),
  ]);
  const stats = summarizePoints(points);
  return {
    range,
    sessions,
    points,
    stops,
    stats: {
      ...stats,
      numberOfStops: stops.length,
      firstCheckIn: sessions[0]?.startedAt || null,
      lastCheckOut:
        [...sessions].reverse().find((session: any) => session.stoppedAt)?.stoppedAt ||
        sessions[sessions.length - 1]?.stoppedAt ||
        null,
    },
  };
};

export const exportRouteCsv = async (workspaceId: string, actor: any, query: RouteQueryInput) => {
  const data = await getRoute(workspaceId, actor, query);
  await (prisma as any).attendanceAuditLog.create({
    data: {
      workspaceId,
      userId: actor.id,
      action: 'LOCATION_ROUTE_EXPORTED',
      details: JSON.stringify({ module: 'location_tracking', targetUserId: query.userId, range: data.range }),
    },
  });
  const header = ['Recorded At', 'Latitude', 'Longitude', 'Accuracy', 'Speed', 'Heading', 'Battery'];
  const rows = data.points.map((point: any) => [
    new Date(point.recordedAt).toISOString(),
    point.latitude,
    point.longitude,
    point.accuracy ?? '',
    point.speed ?? '',
    point.heading ?? '',
    point.batteryPercentage ?? '',
  ]);
  return [header, ...rows]
    .map((row: Array<string | number>) => row.map((cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
};

export const getVisitHistory = async (workspaceId: string, actor: any, query: { userId?: string, startDate?: string, endDate?: string }) => {
  if (query.userId) await ensureUserVisible(workspaceId, actor, query.userId);
  const where: any = { workspaceId };
  if (query.userId) where.userId = query.userId;
  if (query.startDate || query.endDate) {
    const start = query.startDate ? new Date(query.startDate) : undefined;
    const end = query.endDate ? new Date(query.endDate) : undefined;
    if (start || end) {
      where.startedAt = {};
      if (start) where.startedAt.gte = start;
      if (end) where.startedAt.lte = end;
    }
  }

  const stops = await (prisma as any).locationStop.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    include: { user: { select: { name: true } } }
  });

  // Group by address
  const history: Record<string, { visits: number, totalDuration: number, lastVisit: Date, userName?: string }> = {};
  stops.forEach((s: any) => {
    const key = s.address || `${s.latitude.toFixed(4)},${s.longitude.toFixed(4)}`;
    if (!history[key]) {
      history[key] = { visits: 0, totalDuration: 0, lastVisit: s.startedAt, userName: s.user?.name };
    }
    history[key].visits++;
    history[key].totalDuration += s.durationSeconds;
    if (new Date(s.startedAt) > new Date(history[key].lastVisit)) {
      history[key].lastVisit = s.startedAt;
    }
  });

  return Object.entries(history).map(([address, stats]) => ({
    address,
    visits: stats.visits,
    averageDuration: Math.round(stats.totalDuration / stats.visits),
    lastVisit: stats.lastVisit,
    userName: stats.userName,
  })).sort((a, b) => b.visits - a.visits);
};
