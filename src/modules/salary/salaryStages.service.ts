import prisma from '../../config/prisma';
import {
  CreateApprovalStageInput,
  UpdateApprovalStageInput,
  ReorderApprovalStagesInput,
  SalaryReleaseSettingInput,
} from './salary.types';

/**
 * List all configured approval stages for workspace
 */
export const listApprovalStages = async (workspaceId: string) => {
  const stages = await (prisma as any).salaryApprovalStage.findMany({
    where: { workspaceId },
    orderBy: { order: 'asc' },
    include: {
      approverUser: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          profileImageUrl: true,
          role: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      },
    },
  });

  const setting = await (prisma as any).salarySetting.findUnique({
    where: { workspaceId },
  });

  return {
    stages,
    salaryReleaseDay: setting?.salaryReleaseDay ?? 25,
  };
};

/**
 * Create a new approval stage level
 */
export const createApprovalStage = async (
  input: CreateApprovalStageInput,
  workspaceId: string,
  createdById: string,
) => {
  // Check approver user exists in workspace
  const user = await (prisma as any).user.findFirst({
    where: { id: input.approverUserId, workspaceId, deletedAt: null },
  });
  if (!user) {
    const err: any = new Error('Approver user not found in workspace.');
    err.statusCode = 404;
    throw err;
  }

  let targetOrder: number;

  if (input.order !== undefined && input.order !== null && !isNaN(Number(input.order))) {
    targetOrder = Number(input.order);
    const orderExists = await (prisma as any).salaryApprovalStage.findUnique({
      where: { workspaceId_order: { workspaceId, order: targetOrder } },
    });
    if (orderExists) {
      const err: any = new Error('Sort Order already exists.');
      err.statusCode = 400;
      throw err;
    }
  } else {
    // Automatically place after highest existing sort order
    const maxStage = await (prisma as any).salaryApprovalStage.findFirst({
      where: { workspaceId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    targetOrder = maxStage ? maxStage.order + 1 : 1;
  }

  const stage = await (prisma as any).salaryApprovalStage.create({
    data: {
      workspaceId,
      name: input.name,
      order: targetOrder,
      approverUserId: input.approverUserId,
      designation: input.designation || null,
      isMandatory: input.isMandatory !== undefined ? input.isMandatory : true,
      isActive: input.isActive !== undefined ? input.isActive : true,
      createdBy: createdById,
    },
    include: {
      approverUser: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          profileImageUrl: true,
          department: { select: { id: true, name: true } },
          office: { select: { id: true, name: true } },
          role: { select: { id: true, name: true } },
        },
      },
    },
  });

  return stage;
};

/**
 * Update an existing approval stage
 */
export const updateApprovalStage = async (
  id: string,
  input: UpdateApprovalStageInput,
  workspaceId: string,
) => {
  const existing = await (prisma as any).salaryApprovalStage.findFirst({
    where: { id, workspaceId },
  });

  if (!existing) {
    const err: any = new Error('Approval stage not found.');
    err.statusCode = 404;
    throw err;
  }

  if (input.approverUserId) {
    const user = await (prisma as any).user.findFirst({
      where: { id: input.approverUserId, workspaceId, deletedAt: null },
    });
    if (!user) {
      const err: any = new Error('Approver user not found in workspace.');
      err.statusCode = 404;
      throw err;
    }
  }

  if (input.order !== undefined && input.order !== null && Number(input.order) !== existing.order) {
    const orderExists = await (prisma as any).salaryApprovalStage.findFirst({
      where: { workspaceId, order: Number(input.order), NOT: { id } },
    });
    if (orderExists) {
      const err: any = new Error('Sort Order already exists.');
      err.statusCode = 400;
      throw err;
    }
  }

  const updated = await (prisma as any).salaryApprovalStage.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.approverUserId !== undefined ? { approverUserId: input.approverUserId } : {}),
      ...(input.designation !== undefined ? { designation: input.designation } : {}),
      ...(input.isMandatory !== undefined ? { isMandatory: input.isMandatory } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: {
      approverUser: {
        select: {
          id: true,
          name: true,
          email: true,
          role: { select: { id: true, name: true } },
        },
      },
    },
  });

  return updated;
};

/**
 * Delete an approval stage level
 */
export const deleteApprovalStage = async (id: string, workspaceId: string) => {
  const existing = await (prisma as any).salaryApprovalStage.findFirst({
    where: { id, workspaceId },
  });

  if (!existing) {
    const err: any = new Error('Approval stage not found.');
    err.statusCode = 404;
    throw err;
  }

  const deletedOrder = existing.order;

  await (prisma as any).salaryApprovalStage.delete({ where: { id } });

  // Shift remaining orders down by 1
  await (prisma as any).salaryApprovalStage.updateMany({
    where: {
      workspaceId,
      order: { gt: deletedOrder },
    },
    data: {
      order: { decrement: 1 },
    },
  });

  return { message: 'Approval stage deleted successfully.' };
};

/**
 * Reorder approval stages
 */
export const reorderApprovalStages = async (
  input: ReorderApprovalStagesInput,
  workspaceId: string,
) => {
  for (const item of input.stages) {
    await (prisma as any).salaryApprovalStage.updateMany({
      where: { id: item.id, workspaceId },
      data: { order: item.order },
    });
  }

  return listApprovalStages(workspaceId);
};

/**
 * Set salary release date setting
 */
export const updateSalaryReleaseSetting = async (
  input: SalaryReleaseSettingInput,
  workspaceId: string,
) => {
  const setting = await (prisma as any).salarySetting.upsert({
    where: { workspaceId },
    update: { salaryReleaseDay: input.salaryReleaseDay },
    create: { workspaceId, salaryReleaseDay: input.salaryReleaseDay },
  });

  return setting;
};
