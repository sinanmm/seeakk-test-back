import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import type { CreateTargetInput, UpdateTargetInput } from '../../validations/targetValidation';

/**
 * Assign or Update Target for a User
 */
export const upsertTarget = async (userId: string, workspaceId: string, input: CreateTargetInput) => {
  // Check if target type exists
  const targetType = await (prisma as any).targetType.findUnique({
    where: { id: input.targetTypeId }
  });
  
  if (!targetType) {
    const err: any = new Error('Target type not found.');
    err.statusCode = 404;
    throw err;
  }

  // Scoped to user and workspace
  const target = await (prisma as any).targetSetting.create({
    data: {
      ...input,
      userId,
      workspaceId,
    }
  });

  logger.info('Target assigned to user', { userId, workspaceId, targetId: target.id });
  return target;
};

/**
 * Get User Targets
 */
export const getUserTargets = async (userId: string, workspaceId: string) => {
  return await (prisma as any).targetSetting.findMany({
    where: { userId, workspaceId },
    include: { targetType: true },
    orderBy: { createdAt: 'desc' }
  });
};

/**
 * Update a specific target setting
 */
export const updateTarget = async (
  targetId: string,
  userId: string,
  workspaceId: string,
  input: UpdateTargetInput,
) => {
  const existing = await (prisma as any).targetSetting.findFirst({
    where: { id: targetId, userId, workspaceId }
  });

  if (!existing) {
    const err: any = new Error('Target setting not found for this user in this workspace.');
    err.statusCode = 404;
    throw err;
  }

  return await (prisma as any).targetSetting.update({
    where: { id: targetId },
    data: input
  });
};

/**
 * Get all available target types
 */
export const getTargetTypes = async () => {
  return await (prisma as any).targetType.findMany();
};
