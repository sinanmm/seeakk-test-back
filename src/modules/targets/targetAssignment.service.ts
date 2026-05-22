import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import { buildTargetCyclePeriods, type PeriodInput } from './targetPeriod.util';

const db = prisma as any;

export type AssignmentClient = {
  user: { findFirst: typeof db.user.findFirst; update: typeof db.user.update };
  targetCycle: { findFirst: typeof db.targetCycle.findFirst };
  targetAssignment: {
    updateMany: typeof db.targetAssignment.updateMany;
    upsert: typeof db.targetAssignment.upsert;
  };
  targetPerformanceLog: { upsert: typeof db.targetPerformanceLog.upsert };
};

export const assignTargetCycleToUserWithClient = async (
  client: AssignmentClient,
  workspaceId: string,
  userId: string,
  targetCycleId: string,
  assignedById: string,
) => {
  const user = await client.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, supervisorId: true, assignedTargetCycleId: true },
  });
  if (!user) {
    throw Object.assign(new Error('User not found in this workspace.'), { statusCode: 404 });
  }

  const cycle = await client.targetCycle.findFirst({
    where: { id: targetCycleId, workspaceId, deletedAt: null, status: 'ACTIVE' },
    include: { periods: { orderBy: { periodIndex: 'asc' } } },
  });
  if (!cycle) {
    throw Object.assign(
      new Error('Target cycle not found or inactive. Choose an active cycle from Master Configuration.'),
      { statusCode: 404 },
    );
  }

  if (cycle.targetMetric === 'LEADS' && !cycle.leadStageId) {
    throw Object.assign(
      new Error(
        'This target cycle tracks leads but has no lead stage configured. Edit the cycle in Master Configuration and set a lead stage, then assign again.',
      ),
      { statusCode: 422 },
    );
  }

  if (!cycle.periods?.length) {
    throw Object.assign(
      new Error(
        'This target cycle has no performance periods. Edit the cycle and add at least one period before assigning users.',
      ),
      { statusCode: 422 },
    );
  }

  await client.targetAssignment.updateMany({
    where: { userId, workspaceId, isActive: true },
    data: { isActive: false },
  });

  const assignment = await client.targetAssignment.upsert({
    where: { userId_targetCycleId: { userId, targetCycleId } },
    create: {
      userId,
      targetCycleId,
      workspaceId,
      supervisorId: user.supervisorId,
      assignedById,
      isActive: true,
    },
    update: {
      isActive: true,
      supervisorId: user.supervisorId,
      assignedById,
      assignedAt: new Date(),
    },
  });

  await client.user.update({
    where: { id: userId },
    data: { assignedTargetCycleId: targetCycleId },
  });

  for (const period of cycle.periods) {
    await client.targetPerformanceLog.upsert({
      where: { assignmentId_periodId: { assignmentId: assignment.id, periodId: period.id } },
      create: {
        assignmentId: assignment.id,
        periodId: period.id,
        targetCount: period.targetCount,
        status: 'PENDING',
      },
      update: { targetCount: period.targetCount, status: 'PENDING' },
    });
  }

  return { assignment, previousTargetCycleId: user.assignedTargetCycleId, cycle };
};

export const clearUserTargetCycleWithClient = async (
  client: AssignmentClient,
  workspaceId: string,
  userId: string,
) => {
  const user = await client.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, assignedTargetCycleId: true },
  });
  if (!user) {
    throw Object.assign(new Error('User not found in this workspace.'), { statusCode: 404 });
  }

  await client.targetAssignment.updateMany({
    where: { userId, workspaceId, isActive: true },
    data: { isActive: false },
  });
  await client.user.update({
    where: { id: userId },
    data: { assignedTargetCycleId: null },
  });

  return user.assignedTargetCycleId;
};

export const assignTargetCycleToUser = async (
  workspaceId: string,
  userId: string,
  targetCycleId: string,
  assignedById: string,
) => assignTargetCycleToUserWithClient(db, workspaceId, userId, targetCycleId, assignedById);

export const clearUserTargetCycle = async (workspaceId: string, userId: string) => {
  await clearUserTargetCycleWithClient(db, workspaceId, userId);
};

/** Assign or clear a user's target cycle. Pass `null` to remove. Omit field on update to leave unchanged. */
export const syncUserTargetCycleAssignment = async (
  workspaceId: string,
  userId: string,
  targetCycleId: string | null | undefined,
  assignedById: string,
  auditContext?: { ipAddress?: string; userAgent?: string },
) => {
  if (targetCycleId === undefined) return null;

  const normalized = typeof targetCycleId === 'string' && targetCycleId.trim() ? targetCycleId.trim() : null;

  const result = await prisma.$transaction(async (tx) => {
    const client = tx as unknown as AssignmentClient;

    if (!normalized) {
      const previousTargetCycleId = await clearUserTargetCycleWithClient(client, workspaceId, userId);
      return { assignment: null, previousTargetCycleId, targetCycleName: null as string | null };
    }

    const { assignment, previousTargetCycleId, cycle } = await assignTargetCycleToUserWithClient(
      client,
      workspaceId,
      userId,
      normalized,
      assignedById,
    );

    return { assignment, previousTargetCycleId, targetCycleName: cycle.name };
  });

  if (!normalized && result.previousTargetCycleId) {
    await auditService.log({
      userId: assignedById,
      workspaceId,
      action: 'USER_TARGET_CYCLE_REMOVED',
      entityType: 'User',
      entityId: userId,
      details: { previousTargetCycleId: result.previousTargetCycleId },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });
    return null;
  }

  if (normalized && result.assignment) {
    await auditService.log({
      userId: assignedById,
      workspaceId,
      action: 'USER_TARGET_CYCLE_ASSIGNED',
      entityType: 'User',
      entityId: userId,
      details: {
        previousTargetCycleId: result.previousTargetCycleId,
        targetCycleId: normalized,
        targetCycleName: result.targetCycleName,
        assignmentId: result.assignment.id,
      },
      ipAddress: auditContext?.ipAddress,
      userAgent: auditContext?.userAgent,
    });
  }

  return result.assignment;
};

export const persistTargetCycleWithPeriods = async (
  workspaceId: string,
  createdBy: string,
  payload: {
    name: string;
    description?: string;
    targetType: string;
    targetMetric: string;
    leadStageId?: string | null;
    startDate: string;
    endDate?: string | null;
    numberOfMonths?: number | null;
    status?: string;
    lockingEnabled?: boolean;
    periodCounts?: number[];
    periods?: Array<{
      label: string;
      periodIndex: number;
      targetCount: number;
      startDate: string | Date;
      endDate: string | Date;
      lockingDate: string | Date;
    }>;
  },
  existingId?: string,
) => {
  const periods = buildTargetCyclePeriods({
    targetType: payload.targetType as any,
    startDate: new Date(payload.startDate),
    endDate: payload.endDate ? new Date(payload.endDate) : null,
    numberOfMonths: payload.numberOfMonths,
    periodCounts: payload.periodCounts,
    periods: payload.periods,
  });

  if (payload.targetMetric === 'LEADS' && !payload.leadStageId) {
    throw Object.assign(new Error('Lead stage is required when target metric is Leads.'), { statusCode: 422 });
  }

  if (payload.leadStageId) {
    const stage = await db.leadStage.findFirst({
      where: { id: payload.leadStageId, workspaceId, isLOB: false, deletedAt: null },
    });
    if (!stage) {
      throw Object.assign(new Error('Invalid lead stage. LOB stages cannot be used for targets.'), { statusCode: 422 });
    }
  }

  const data = {
    name: payload.name.trim(),
    description: payload.description?.trim() || null,
    workspaceId,
    targetType: payload.targetType,
    targetMetric: payload.targetMetric,
    leadStageId: payload.leadStageId || null,
    startDate: new Date(payload.startDate),
    endDate: payload.endDate ? new Date(payload.endDate) : null,
    numberOfMonths: payload.numberOfMonths ?? periods.length,
    status: payload.status || 'ACTIVE',
    lockingEnabled: payload.lockingEnabled !== false,
    totalDays: 30,
    createdBy,
  };

  let cycle;
  if (existingId) {
    cycle = await db.targetCycle.update({ where: { id: existingId }, data });
    await db.targetCyclePeriod.deleteMany({ where: { targetCycleId: existingId } });
  } else {
    const duplicate = await db.targetCycle.findFirst({
      where: { workspaceId, name: data.name, deletedAt: null },
    });
    if (duplicate) {
      throw Object.assign(new Error('Target cycle name already exists.'), { statusCode: 409 });
    }
    cycle = await db.targetCycle.create({ data });
  }

  await db.targetCyclePeriod.createMany({
    data: periods.map((period) => ({
      targetCycleId: cycle.id,
      label: period.label,
      periodIndex: period.periodIndex,
      targetCount: period.targetCount,
      startDate: period.startDate,
      endDate: period.endDate,
      lockingDate: period.lockingDate,
    })),
  });

  return db.targetCycle.findUnique({
    where: { id: cycle.id },
    include: { periods: { orderBy: { periodIndex: 'asc' } }, leadStage: { select: { id: true, name: true, color: true } } },
  });
};
