import prisma from '../../../config/prisma';
import type { CreateSubstageInput, UpdateSubstageInput } from './substage.validation';

const createError = (message: string, statusCode: number) => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const listSubstages = async (workspaceId: string, leadStageId?: string) => {
  const where: any = {
    workspaceId,
    deletedAt: null,
  };
  if (leadStageId) {
    where.leadStageId = leadStageId;
  }

  return (prisma as any).leadSubstage.findMany({
    where,
    orderBy: [{ leadStage: { order: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      leadStage: {
        select: {
          id: true,
          name: true,
          color: true,
          order: true,
          isApprovalRequired: true,
          isLOB: true,
          isClosed: true,
        },
      },
    },
  });
};

export const getSubstagesGroupedByStage = async (workspaceId: string) => {
  const stages = await (prisma as any).leadStage.findMany({
    where: { workspaceId, deletedAt: null, status: 'ACTIVE' },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      name: true,
      color: true,
      order: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
      substages: {
        where: { workspaceId, deletedAt: null, status: 'ACTIVE' },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  return stages;
};

export const createSubstage = async (
  workspaceId: string,
  input: CreateSubstageInput,
  createdById?: string,
) => {
  const stage = await (prisma as any).leadStage.findFirst({
    where: { id: input.leadStageId, workspaceId, deletedAt: null },
  });
  if (!stage) {
    throw createError('Main lead stage not found', 404);
  }

  const existing = await (prisma as any).leadSubstage.findFirst({
    where: { workspaceId, leadStageId: input.leadStageId, name: input.name, deletedAt: null },
  });
  if (existing) {
    throw createError('Substage with this name already exists under the selected stage', 400);
  }

  return (prisma as any).leadSubstage.create({
    data: {
      workspaceId,
      leadStageId: input.leadStageId,
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
      connectionStatusRestriction: input.connectionStatusRestriction,
      outcomeCategory: input.outcomeCategory,
      createdById,
    },
    include: {
      leadStage: {
        select: { id: true, name: true, color: true },
      },
    },
  });
};

export const updateSubstage = async (
  workspaceId: string,
  id: string,
  input: UpdateSubstageInput,
) => {
  const substage = await (prisma as any).leadSubstage.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!substage) {
    throw createError('Substage not found', 404);
  }

  if (input.name && input.name !== substage.name) {
    const existing = await (prisma as any).leadSubstage.findFirst({
      where: {
        workspaceId,
        leadStageId: substage.leadStageId,
        name: input.name,
        id: { not: id },
        deletedAt: null,
      },
    });
    if (existing) {
      throw createError('Substage with this name already exists under the main stage', 400);
    }
  }

  return (prisma as any).leadSubstage.update({
    where: { id },
    data: { ...input },
    include: {
      leadStage: {
        select: { id: true, name: true, color: true },
      },
    },
  });
};

export const toggleSubstageStatus = async (workspaceId: string, id: string) => {
  const substage = await (prisma as any).leadSubstage.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!substage) {
    throw createError('Substage not found', 404);
  }

  const nextStatus = substage.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  return (prisma as any).leadSubstage.update({
    where: { id },
    data: { status: nextStatus },
    include: {
      leadStage: {
        select: { id: true, name: true, color: true },
      },
    },
  });
};

export const deleteSubstage = async (workspaceId: string, id: string) => {
  const substage = await (prisma as any).leadSubstage.findFirst({
    where: { id, workspaceId, deletedAt: null },
  });
  if (!substage) {
    throw createError('Substage not found', 404);
  }

  return (prisma as any).leadSubstage.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};
