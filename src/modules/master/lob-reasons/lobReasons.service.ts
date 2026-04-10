import { LOBReasonStatus } from '../../../../prisma/generated/client';
import auditService from '../../../services/Audit/auditService';
import * as repository from './lobReasons.repository';
import type {
  CreateLOBReasonInput,
  ListLOBReasonsQueryInput,
  ToggleLOBReasonStatusInput,
  UpdateLOBReasonInput,
} from './lobReasons.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

const SYSTEM_SLA_REASON_ID = 'SYSTEM_SLA_EXPIRED';

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

const mapLOBReason = (row: any) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  createdBy: row.createdBy
    ? {
        ...row.createdBy,
        displayName: resolveDisplayName(row.createdBy),
      }
    : null,
  updatedBy: row.updatedBy
    ? {
        ...row.updatedBy,
        displayName: resolveDisplayName(row.updatedBy),
      }
    : null,
});

const mapLOBReasonOption = (row: { id: string; name: string; status: LOBReasonStatus }) => ({
  id: row.id,
  name: row.name,
  status: row.status,
});

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureLOBReasonSchemaReady();
  if (!ready) {
    throw createServiceError(
      'LOB reasons module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const getPermissionKeys = async (actor: Actor): Promise<string[]> => {
  if (!actor.roleId) return [];
  if (normalizeRoleKey(actor.role?.name) === 'superadmin') return ['*'];
  return repository.getRolePermissionKeys(actor.roleId);
};

const canManageLOBReasons = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return (
    permissions.includes('*') ||
    permissions.includes('LOB_REASONS_CREATE') ||
    permissions.includes('LOB_REASONS_EDIT') ||
    permissions.includes('LOB_REASONS_DELETE') ||
    permissions.includes('SYSTEM_CONFIG')
  );
};

const canViewAllLOBReasons = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return permissions.includes('*') || permissions.includes('LOB_REASONS_VIEW') || permissions.includes('SYSTEM_CONFIG');
};

const assertManageLOBReasons = async (actor: Actor): Promise<void> => {
  if (await canManageLOBReasons(actor)) return;
  throw createServiceError('Access denied. You need LOB reason management permissions.', 403);
};

export const assertActiveLOBReason = async (workspaceId: string, reasonId: string): Promise<void> => {
  if (reasonId === SYSTEM_SLA_REASON_ID) return;

  await ensureModuleReady();
  const reason = await repository.findActiveById(workspaceId, reasonId);
  if (!reason) {
    throw createServiceError('Invalid LOB reason. Please choose an active LOB reason.', 422);
  }
};

export const createLOBReason = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLOBReasonInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLOBReasons(actor);

  const exists = await repository.findByName(workspaceId, input.name);
  if (exists) {
    throw createServiceError(`LOB reason '${input.name}' already exists.`, 409);
  }

  const created = await repository.createLOBReason({
    workspaceId,
    name: input.name.trim(),
    status: input.status ?? LOBReasonStatus.ACTIVE,
    createdById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOB_REASON_CREATED',
    entityType: 'LOBReason',
    entityId: created.id,
    details: {
      name: created.name,
      status: created.status,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLOBReason(created);
};

export const listLOBReasons = async (workspaceId: string, actor: Actor, query: ListLOBReasonsQueryInput) => {
  await ensureModuleReady();

  const canViewAll = await canViewAllLOBReasons(actor);
  const canManage = await canManageLOBReasons(actor);

  const where: any = {
    workspaceId,
    deletedAt: null,
  };

  if (query.search) {
    where.name = {
      contains: query.search,
      mode: 'insensitive',
    };
  }

  if (canViewAll || canManage) {
    if (query.status) {
      where.status = query.status;
    }
  } else {
    where.status = LOBReasonStatus.ACTIVE;
  }

  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await repository.listLOBReasons(where, skip, query.limit);

  return {
    data: rows.map(mapLOBReason),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const listActiveLOBReasons = async (workspaceId: string) => {
  await ensureModuleReady();

  const rows = await repository.listActiveLOBReasonOptions(workspaceId);
  return rows.map(mapLOBReasonOption);
};

export const updateLOBReason = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateLOBReasonInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLOBReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('LOB reason not found in this workspace.', 404);
  }

  const nextName = input.name?.trim() ?? existing.name;
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const nameTaken = await repository.findByName(workspaceId, nextName, id);
    if (nameTaken) {
      throw createServiceError(`LOB reason '${nextName}' already exists.`, 409);
    }
  }

  const updated = await repository.updateLOBReason(id, {
    name: nextName,
    status: input.status ?? existing.status,
    updatedById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOB_REASON_UPDATED',
    entityType: 'LOBReason',
    entityId: updated.id,
    details: {
      previousName: existing.name,
      nextName: updated.name,
      previousStatus: existing.status,
      nextStatus: updated.status,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLOBReason(updated);
};

export const toggleLOBReasonStatus = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: ToggleLOBReasonStatusInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLOBReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('LOB reason not found in this workspace.', 404);
  }

  const nextStatus =
    input.status ?? (existing.status === LOBReasonStatus.ACTIVE ? LOBReasonStatus.INACTIVE : LOBReasonStatus.ACTIVE);

  const updated = await repository.updateLOBReason(id, {
    status: nextStatus,
    updatedById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: nextStatus === LOBReasonStatus.ACTIVE ? 'LOB_REASON_ACTIVATED' : 'LOB_REASON_DEACTIVATED',
    entityType: 'LOBReason',
    entityId: updated.id,
    details: {
      previousStatus: existing.status,
      nextStatus,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLOBReason(updated);
};

export const deleteLOBReason = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLOBReasons(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('LOB reason not found in this workspace.', 404);
  }

  const activeUsageCount = await repository.countActiveLeadUsage(workspaceId, id);
  if (activeUsageCount > 0) {
    throw createServiceError('LOB reason is used in active leads and cannot be deactivated.', 409);
  }

  const deleted = await repository.softDeleteLOBReason(id, actor.id);

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOB_REASON_DEACTIVATED',
    entityType: 'LOBReason',
    entityId: deleted.id,
    details: {
      name: deleted.name,
      status: deleted.status,
      softDeleted: true,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLOBReason(deleted);
};
