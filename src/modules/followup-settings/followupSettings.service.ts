import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import { UpdateFollowUpSettingsInput, GrantTemporaryAccessInput } from './followupSettings.validation';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const getSettings = async (workspaceId: string) => {
  let settings = await (prisma as any).followUpSettings.findUnique({
    where: { workspaceId },
  });

  if (!settings) {
    settings = await (prisma as any).followUpSettings.create({
      data: {
        workspaceId,
        dailyLimitEnabled: false,
        dailyLimitCount: 10,
        isActive: true,
        capacityValidationEnabled: false,
        bulkExtensionEnabled: false,
        autoDistributionEnabled: false,
        defaultBulkExtensionDuration: '1 Day',
        maxBulkExtensionCount: 100,
      },
    });
  }

  return settings;
};

export const updateSettings = async (
  workspaceId: string,
  actorId: string,
  input: UpdateFollowUpSettingsInput,
) => {
  const existing = await getSettings(workspaceId);

  const updated = await (prisma as any).followUpSettings.update({
    where: { id: existing.id },
    data: input,
  });

  // Log in AuditLog
  await (prisma as any).auditLog.create({
    data: {
      userId: actorId,
      workspaceId,
      action: 'SETTINGS_UPDATED',
      entityType: 'FollowUpSettings',
      entityId: updated.id,
      details: {
        oldValue: existing,
        newValue: updated,
      },
    },
  });

  return updated;
};

export const listTemporaryAccess = async (workspaceId: string) => {
  // Query all temporary accesses
  const list = await (prisma as any).temporaryBulkExtensionAccess.findMany({
    where: { workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      grantedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return list;
};

export const grantTemporaryAccess = async (
  workspaceId: string,
  grantedById: string,
  input: GrantTemporaryAccessInput,
) => {
  // Verify user exists in the workspace
  const user = await prisma.user.findFirst({
    where: { id: input.userId, workspaceId, deletedAt: null },
  });

  if (!user) {
    throw createServiceError('Target user not found in this workspace.', 404);
  }

  // Calculate expiresAt
  let expiresAt: Date;
  const now = new Date();
  if (input.duration === '1 Day') {
    expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  } else if (input.duration === '3 Days') {
    expiresAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  } else if (input.duration === '7 Days') {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  } else if (input.duration === 'Custom') {
    if (!input.customExpiryDate) {
      throw createServiceError('Custom expiry date is required for Custom duration.', 422);
    }
    expiresAt = new Date(input.customExpiryDate);
  } else {
    throw createServiceError('Invalid duration type.', 422);
  }

  // Deactivate any existing active temporary access entries for this user
  await (prisma as any).temporaryBulkExtensionAccess.updateMany({
    where: {
      userId: input.userId,
      workspaceId,
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });

  // Create temporary access entry
  const entry = await (prisma as any).temporaryBulkExtensionAccess.create({
    data: {
      userId: input.userId,
      workspaceId,
      grantedById,
      duration: input.duration,
      startsAt: now,
      expiresAt,
      isActive: true,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      grantedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Create audit log
  await (prisma as any).auditLog.create({
    data: {
      userId: grantedById,
      workspaceId,
      action: 'TEMPORARY_ACCESS_GRANTED',
      entityType: 'TemporaryBulkExtensionAccess',
      entityId: entry.id,
      details: {
        userId: input.userId,
        userName: user.name || user.email,
        duration: input.duration,
        expiresAt,
      },
    },
  });

  return entry;
};

export const revokeTemporaryAccess = async (workspaceId: string, grantedById: string, id: string) => {
  const existing = await (prisma as any).temporaryBulkExtensionAccess.findFirst({
    where: { id, workspaceId },
  });

  if (!existing) {
    throw createServiceError('Temporary access record not found.', 404);
  }

  const updated = await (prisma as any).temporaryBulkExtensionAccess.update({
    where: { id },
    data: { isActive: false },
    include: {
      user: { select: { name: true, email: true } },
    },
  });

  // Log audit
  await (prisma as any).auditLog.create({
    data: {
      userId: grantedById,
      workspaceId,
      action: 'TEMPORARY_ACCESS_REVOKED',
      entityType: 'TemporaryBulkExtensionAccess',
      entityId: id,
      details: {
        userId: updated.userId,
        userName: updated.user.name || updated.user.email,
      },
    },
  });

  return updated;
};
