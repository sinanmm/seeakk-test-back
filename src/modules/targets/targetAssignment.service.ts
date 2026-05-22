import prisma from '../../config/prisma';
import { buildTargetCyclePeriods, type PeriodInput } from './targetPeriod.util';

const db = prisma as any;

export const assignTargetCycleToUser = async (
  workspaceId: string,
  userId: string,
  targetCycleId: string,
  assignedById: string,
) => {
  const user = await db.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: { id: true, supervisorId: true },
  });
  if (!user) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404 });
  }

  const cycle = await db.targetCycle.findFirst({
    where: { id: targetCycleId, workspaceId, deletedAt: null, status: 'ACTIVE' },
    include: { periods: { orderBy: { periodIndex: 'asc' } } },
  });
  if (!cycle) {
    throw Object.assign(new Error('Target cycle not found or inactive.'), { statusCode: 404 });
  }

  if (cycle.targetMetric === 'LEADS' && !cycle.leadStageId) {
    throw Object.assign(new Error('Lead stage is required for lead-based target cycles.'), { statusCode: 422 });
  }

  await db.targetAssignment.updateMany({
    where: { userId, workspaceId, isActive: true },
    data: { isActive: false },
  });

  const assignment = await db.targetAssignment.upsert({
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

  await db.user.update({
    where: { id: userId },
    data: { assignedTargetCycleId: targetCycleId },
  });

  for (const period of cycle.periods) {
    await db.targetPerformanceLog.upsert({
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

  return assignment;
};

export const clearUserTargetCycle = async (workspaceId: string, userId: string) => {
  await db.targetAssignment.updateMany({
    where: { userId, workspaceId, isActive: true },
    data: { isActive: false },
  });
  await db.user.update({
    where: { id: userId },
    data: { assignedTargetCycleId: null },
  });
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
