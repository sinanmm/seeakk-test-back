import { Prisma, ReportBaseDataSource, ReportTypeStatus } from '../../../prisma/generated/client';
import { redisClient } from '../../config/redis';
import auditService from '../../services/Audit/auditService';
import * as repository from './reportTypes.repository';
import type {
  AllowedReportFilterKey,
  CreateReportTypeInput,
  ListReportTypesQueryInput,
  ToggleReportTypeStatusInput,
  UpdateReportTypeInput,
} from './reportTypes.validation';

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

const FILTERS_BY_SOURCE: Record<ReportBaseDataSource, AllowedReportFilterKey[]> = {
  LEADS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date'],
  USERS: ['created_date', 'role', 'department', 'office', 'status'],
  FOLLOWUPS: ['stage', 'assignee', 'lead_source', 'created_date', 'follow_up_date', 'status'],
};

const getCacheKey = (workspaceId: string, query: ListReportTypesQueryInput, canManage: boolean): string =>
  `report_types:${workspaceId}:${canManage ? 'manage' : 'view'}:${JSON.stringify(query)}`;

const clearCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isReady) return;

  const keys: string[] = [];
  for await (const key of redisClient.scanIterator({
    MATCH: `report_types:${workspaceId}:*`,
    COUNT: 100,
  })) {
    keys.push(String(key));
  }

  if (keys.length > 0) {
    await redisClient.del(keys);
  }
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureReportSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Report type module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const getPermissionKeys = async (actor: Actor): Promise<string[]> => {
  if (!actor.roleId) return [];
  if (normalizeRoleKey(actor.role?.name) === 'superadmin') return ['*'];
  return repository.getRolePermissionKeys(actor.roleId);
};

const canManageReportTypes = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return permissions.includes('*') || permissions.includes('REPORT_TYPE_MANAGE') || permissions.includes('SYSTEM_CONFIG');
};

const assertManageAccess = async (actor: Actor): Promise<void> => {
  if (await canManageReportTypes(actor)) return;
  throw createServiceError('Access denied. You need the REPORT_TYPE_MANAGE permission.', 403);
};

const validateAllowedFilters = (
  baseDataSource: ReportBaseDataSource,
  allowedFilters: AllowedReportFilterKey[],
): AllowedReportFilterKey[] => {
  const supported = new Set(FILTERS_BY_SOURCE[baseDataSource]);
  const unsupported = allowedFilters.filter((filterKey) => !supported.has(filterKey));
  if (unsupported.length > 0) {
    throw createServiceError(
      `Unsupported filters for ${baseDataSource.toLowerCase()}: ${unsupported.join(', ')}`,
      422,
    );
  }

  return Array.from(new Set(allowedFilters));
};

const mapReportType = (row: any) => ({
  ...row,
  allowedFilters: Array.isArray(row.allowedFilters) ? row.allowedFilters : [],
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

export const createReportType = async (
  workspaceId: string,
  actor: Actor,
  input: CreateReportTypeInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageAccess(actor);

  const exists = await repository.findByName(workspaceId, input.name);
  if (exists) {
    throw createServiceError(`Report name '${input.name}' already exists.`, 409);
  }

  const allowedFilters = validateAllowedFilters(input.baseDataSource, input.allowedFilters);

  const created = await repository.createReportType({
    workspaceId,
    name: input.name,
    module: input.module,
    baseDataSource: input.baseDataSource,
    description: input.description ?? null,
    allowedFilters: allowedFilters as unknown as Prisma.InputJsonValue,
    status: input.status,
    createdById: actor.id,
  });

  await clearCache(workspaceId);
  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_TYPE_CREATED',
    entityType: 'ReportType',
    entityId: created.id,
    details: {
      module: created.module,
      baseDataSource: created.baseDataSource,
      allowedFilters,
      status: created.status,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReportType(created);
};

export const listReportTypes = async (workspaceId: string, actor: Actor, query: ListReportTypesQueryInput) => {
  await ensureModuleReady();

  const manageAccess = await canManageReportTypes(actor);
  const cacheKey = getCacheKey(workspaceId, query, manageAccess);

  if (redisClient.isReady) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const where: Prisma.ReportTypeWhereInput = {
    workspaceId,
    deletedAt: null,
  };

  if (query.search) {
    where.name = {
      contains: query.search,
      mode: 'insensitive',
    };
  }

  if (query.module) {
    where.module = query.module;
  }

  if (manageAccess) {
    if (query.status) {
      where.status = query.status;
    }
  } else {
    where.status = ReportTypeStatus.ACTIVE;
  }

  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await repository.listReportTypes(where, skip, query.limit);
  const response = {
    data: rows.map(mapReportType),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };

  if (redisClient.isReady) {
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));
  }

  return response;
};

export const updateReportType = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateReportTypeInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageAccess(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  const nextName = input.name ?? existing.name;
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const nameTaken = await repository.findByName(workspaceId, nextName, id);
    if (nameTaken) {
      throw createServiceError(`Report name '${nextName}' already exists.`, 409);
    }
  }

  const nextDataSource = input.baseDataSource ?? existing.baseDataSource;
  const nextAllowedFilters = input.allowedFilters
    ? validateAllowedFilters(nextDataSource, input.allowedFilters)
    : ((Array.isArray(existing.allowedFilters) ? existing.allowedFilters : []) as AllowedReportFilterKey[]);

  const updated = await repository.updateReportType(id, {
    name: nextName,
    module: input.module ?? existing.module,
    baseDataSource: nextDataSource,
    description: input.description === undefined ? existing.description : input.description ?? null,
    allowedFilters: nextAllowedFilters as unknown as Prisma.InputJsonValue,
    status: input.status ?? existing.status,
    updatedById: actor.id,
  });

  await clearCache(workspaceId);
  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_TYPE_UPDATED',
    entityType: 'ReportType',
    entityId: updated.id,
    details: {
      module: updated.module,
      baseDataSource: updated.baseDataSource,
      allowedFilters: nextAllowedFilters,
      status: updated.status,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReportType(updated);
};

export const toggleReportTypeStatus = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: ToggleReportTypeStatusInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageAccess(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  const nextStatus =
    input.status ?? (existing.status === ReportTypeStatus.ACTIVE ? ReportTypeStatus.INACTIVE : ReportTypeStatus.ACTIVE);

  const updated = await repository.updateReportType(id, {
    status: nextStatus,
    updatedById: actor.id,
  });

  await clearCache(workspaceId);
  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: nextStatus === ReportTypeStatus.ACTIVE ? 'REPORT_TYPE_ACTIVATED' : 'REPORT_TYPE_DEACTIVATED',
    entityType: 'ReportType',
    entityId: updated.id,
    details: {
      previousStatus: existing.status,
      nextStatus,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReportType(updated);
};

export const deleteReportType = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageAccess(actor);

  const existing = await repository.findById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Report type not found in this workspace.', 404);
  }

  const deleted = await repository.softDeleteReportType(id, actor.id);

  await clearCache(workspaceId);
  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'REPORT_TYPE_DELETED',
    entityType: 'ReportType',
    entityId: deleted.id,
    details: {
      name: deleted.name,
      module: deleted.module,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapReportType(deleted);
};
