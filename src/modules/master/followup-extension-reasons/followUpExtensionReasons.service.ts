import auditService from '../../../services/Audit/auditService';
import * as repository from './followUpExtensionReasons.repository';
import type {
  CreateExtensionReasonInput,
  ListExtensionReasonsQueryInput,
  ToggleExtensionReasonStatusInput,
  UpdateExtensionReasonInput,
} from './followUpExtensionReasons.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const normalizeRoleKey = (role?: string | null): string =>
  (role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string | null => {
  if (!user) return null;
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return user.username.trim();
  return user.email || null;
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureExtensionReasonSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Follow-up extension reasons module is not ready. Required database schema is missing.',
      503,
    );
  }
};

const getPermissionKeys = async (actor: Actor): Promise<string[]> => {
  if (!actor.roleId) return [];
  if (normalizeRoleKey(actor.role?.name) === 'superadmin') return ['*'];
  return repository.getRolePermissionKeys(actor.roleId);
};

const canManageReasons = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return (
    permissions.includes('*') ||
    permissions.includes('manage_followup_extension_reasons') ||
    permissions.includes('SYSTEM_CONFIG')
  );
};

const canViewReasons = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return (
    permissions.includes('*') ||
    permissions.includes('view_followup_extension_reasons') ||
    permissions.includes('manage_followup_extension_reasons') ||
    permissions.includes('SYSTEM_CONFIG')
  );
};

const assertManageReasons = async (actor: Actor): Promise<void> => {
  if (await canManageReasons(actor)) return;
  throw createServiceError('Access denied. You need manage_followup_extension_reasons permission.', 403);
};

export const assertActiveExtensionReason = async (workspaceId: string, reasonId: string): Promise<void> => {
  await ensureModuleReady();
  const reason = await repository.findActiveById(workspaceId, reasonId);
  if (!reason) {
    throw createServiceError('Invalid or inactive Follow-up Extension reason.', 422);
  }
};

export const createExtensionReason = async (
  workspaceId: string,
  actor: Actor,
  input: CreateExtensionReasonInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageReasons(actor);

  const exists = await repository.findByName(workspaceId, input.reasonName);
  if (exists) {
    throw createServiceError(`Extension reason '${input.reasonName}' already exists.`, 409);
  }

  const created = await repository.createExtensionReason({
    workspaceId,
    reasonName: input.reasonName.trim(),
    description: input.description?.trim() || null,
    isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'FOLLOWUP_EXTENSION_REASON_CREATED',
    entityType: 'FollowUpExtensionReason',
    entityId: created.id,
    details: {
      reasonName: created.reasonName,
      isActive: created.isActive,
      sortOrder: created.sortOrder,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return created;
};

export const listExtensionReasons = async (workspaceId: string, actor: Actor, query: ListExtensionReasonsQueryInput) => {
  await ensureModuleReady();

  const canView = await canViewReasons(actor);
  const where: any = {
    workspaceId,
  };

  if (query.search) {
    where.reasonName = {
      contains: query.search,
    };
  }

  if (canView) {
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
  } else {
    where.isActive = true;
  }

  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await repository.listExtensionReasons(where, skip, query.limit);

  return {
    data: rows,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const listActiveExtensionReasons = async (workspaceId: string) => {
  await ensureModuleReady();
  return repository.listActiveExtensionReasonOptions(workspaceId);
};

export const updateExtensionReason = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateExtensionReasonInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Extension reason not found in this workspace.', 404);
  }

  const nextName = input.reasonName?.trim() ?? existing.reasonName;
  if (nextName.toLowerCase() !== existing.reasonName.toLowerCase()) {
    const nameTaken = await repository.findByName(workspaceId, nextName, id);
    if (nameTaken) {
      throw createServiceError(`Extension reason '${nextName}' already exists.`, 409);
    }
  }

  const updated = await repository.updateExtensionReason(id, {
    reasonName: nextName,
    description: input.description !== undefined ? (input.description?.trim() || null) : existing.description,
    isActive: input.isActive ?? existing.isActive,
    sortOrder: input.sortOrder ?? existing.sortOrder,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'FOLLOWUP_EXTENSION_REASON_UPDATED',
    entityType: 'FollowUpExtensionReason',
    entityId: updated.id,
    details: {
      previousName: existing.reasonName,
      nextName: updated.reasonName,
      previousStatus: existing.isActive,
      nextStatus: updated.isActive,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return updated;
};

export const toggleExtensionReasonStatus = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: ToggleExtensionReasonStatusInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Extension reason not found in this workspace.', 404);
  }

  const nextStatus = input.isActive;

  const updated = await repository.updateExtensionReason(id, {
    isActive: nextStatus,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: nextStatus ? 'FOLLOWUP_EXTENSION_REASON_ACTIVATED' : 'FOLLOWUP_EXTENSION_REASON_DEACTIVATED',
    entityType: 'FollowUpExtensionReason',
    entityId: updated.id,
    details: {
      previousStatus: existing.isActive,
      nextStatus,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return updated;
};

export const deleteExtensionReason = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Extension reason not found in this workspace.', 404);
  }

  const deleted = await repository.deleteExtensionReason(id);

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'FOLLOWUP_EXTENSION_REASON_DELETED',
    entityType: 'FollowUpExtensionReason',
    entityId: deleted.id,
    details: {
      reasonName: deleted.reasonName,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return deleted;
};
