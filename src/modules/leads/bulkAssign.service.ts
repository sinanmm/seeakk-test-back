import * as repository from './bulkAssign.repository';
import type { BulkAssignFiltersInput, BulkAssignInput, BulkAssignPreviewInput } from './bulkAssign.validation';
import { buildAccessWhere } from './leads.service';
import { clearLeadCache } from '../../services/User/leadService';
import { redisClient } from '../../config/redis';

export const clearFollowUpCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isOpen) return;

  try {
    const keysToDelete: string[] = [];
    const pattern = `followups:today:${workspaceId}:*`;

    for await (const key of (redisClient as any).scanIterator({ MATCH: pattern, COUNT: 250 })) {
      if (typeof key === 'string' && key.length > 0) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length === 0) {
      const keys = await (redisClient as any).keys(pattern);
      if (Array.isArray(keys)) {
        keys.forEach((k) => {
          if (typeof k === 'string' && k.length > 0) keysToDelete.push(k);
        });
      }
    }

    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
    }
  } catch (error) {
    // Fail-safe cache invalidation
  }
};


type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

const MAX_BULK_ASSIGN_SIZE = 5000;

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string => {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.username?.trim()) return user.username.trim();
  return user?.email || 'Unknown user';
};

const buildLeadPreviewItems = (rows: any[]) =>
  rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt,
    nextFollowUpAt: row.nextFollowUpAt,
    assignedTo: row.assignedTo
      ? {
          id: row.assignedTo.id,
          label: resolveDisplayName(row.assignedTo),
        }
      : null,
    stage: row.stage
      ? {
          id: row.stage.id,
          name: row.stage.name,
        }
      : null,
    source: row.source
      ? {
          id: row.source.id,
          name: row.source.name,
        }
      : null,
    lifecycle: row.lifecycle
      ? {
          id: row.lifecycle.id,
          name: row.lifecycle.name,
        }
      : null,
  }));

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureBulkAssignSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Bulk assign module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const buildLeadFilterWhere = async (workspaceId: string, actor: Actor, filters: BulkAssignFiltersInput): Promise<any> => {
  const accessWhere = await buildAccessWhere(workspaceId, actor);

  const where: any = {
    workspaceId,
    deletedAt: null,
    isClosed: false,
    isLOB: false,
    ...accessWhere,
  };

  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.assignedTo) where.assignedToId = filters.assignedTo;
  if (filters.lifecycleId) where.lifecycleId = filters.lifecycleId;
  if (filters.sourceId) where.sourceId = filters.sourceId;

  if (filters.followupDateFrom || filters.followupDateTo) {
    where.nextFollowUpAt = {
      ...(filters.followupDateFrom ? { gte: filters.followupDateFrom } : {}),
      ...(filters.followupDateTo ? { lte: filters.followupDateTo } : {}),
    };
  }

  if (filters.createdDateFrom || filters.createdDateTo) {
    where.createdAt = {
      ...(filters.createdDateFrom ? { gte: filters.createdDateFrom } : {}),
      ...(filters.createdDateTo ? { lte: filters.createdDateTo } : {}),
    };
  }

  return where;
};

export const previewBulkAssign = async (
  workspaceId: string,
  actor: Actor,
  input: BulkAssignPreviewInput,
) => {
  await ensureModuleReady();

  const { sampleLimit, ...filters } = input;
  const where = await buildLeadFilterWhere(workspaceId, actor, filters);
  const [count, sampleRows] = await Promise.all([
    repository.countMatchingLeads(where),
    repository.findMatchingLeadPreviewRows(where, sampleLimit),
  ]);

  return {
    count,
    sampleLeads: buildLeadPreviewItems(sampleRows),
  };
};

export const bulkAssignLeads = async (
  workspaceId: string,
  actor: Actor,
  input: BulkAssignInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();

  const where = await buildLeadFilterWhere(workspaceId, actor, input.filters);
  const previewCount = await repository.countMatchingLeads(where);

  if (previewCount === 0) {
    throw createServiceError('No active leads matched the provided filters.', 404);
  }

  if (previewCount > MAX_BULK_ASSIGN_SIZE) {
    throw createServiceError(
      `Bulk assign is limited to ${MAX_BULK_ASSIGN_SIZE} leads at a time. Refine the filters and try again.`,
      422,
    );
  }

  const leadIds = await repository.findMatchingLeadIds(where, MAX_BULK_ASSIGN_SIZE);
  if (leadIds.length === 0) {
    throw createServiceError('No active leads matched the provided filters.', 404);
  }

  const assignmentType = input.assignmentType ?? 'SINGLE';

  let assignments: Array<{ leadId: string; assignTo: string }> = [];
  let assigneeLabelMap: Record<string, string> = {};

  if (assignmentType === 'ROUND_ROBIN') {
    const assignees = await repository.findAssignableUsers(workspaceId, input.assignToIds);
    if (assignees.length !== input.assignToIds.length) {
      throw createServiceError('One or more selected assignees are invalid or inactive.', 404);
    }

    assigneeLabelMap = assignees.reduce<Record<string, string>>((accumulator, assignee) => {
      accumulator[assignee.id] = resolveDisplayName(assignee);
      return accumulator;
    }, {});

    assignments = leadIds.map((leadId, index) => ({
      leadId,
      assignTo: assignees[index % assignees.length].id,
    }));
  } else {
    if (!input.assignTo) {
      throw createServiceError('Assignee required', 422);
    }

    const assignee = await repository.findAssignableUser(workspaceId, input.assignTo);
    if (!assignee) {
      throw createServiceError('Invalid assignee. Please choose an active workspace user.', 404);
    }

    assigneeLabelMap = {
      [assignee.id]: resolveDisplayName(assignee),
    };

    assignments = leadIds.map((leadId) => ({
      leadId,
      assignTo: assignee.id,
    }));
  }

  const result = await repository.bulkAssignLeads({
    assignments,
    workspaceId,
    actorId: actor.id,
    filters: input.filters,
    assignmentType,
    assigneeLabelMap,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  if (result.updatedCount === 0) {
    throw createServiceError('No active leads were available to assign. Please refresh and try again.', 409);
  }

  // Clear lead and follow-up caches to trigger real-time UI/Calendar refreshes and prevent stale metrics
  await clearLeadCache(workspaceId);
  await clearFollowUpCache(workspaceId);


  return {
    message:
      assignmentType === 'ROUND_ROBIN'
        ? 'Leads distributed successfully'
        : 'Leads assigned successfully',
    updated_count: result.updatedCount,
    failed_count: result.failedLeadIds.length,
    failed_lead_ids: result.failedLeadIds,
    assignment_type: assignmentType,
    progress: {
      current: result.updatedCount,
      total: leadIds.length,
      status: result.failedLeadIds.length ? 'PARTIAL' : 'COMPLETED',
      transport: 'SYNC_READY_FOR_WEBSOCKET',
    },
  };
};
