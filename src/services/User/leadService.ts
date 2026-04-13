import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { buildClosureUpdateData, isClosureStage } from '../../modules/leads/leads.service';
import * as leadApprovalService from '../../modules/leads/leadApprovals.service';
import { assertActiveLOBReason } from '../../modules/master/lob-reasons/lobReasons.service';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExportLeadsQueryInput,
  ListLeadsQueryInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';

const LEADS_CACHE_TTL_SECONDS = 60;

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type SlaAction = 'AUTO_LOB' | 'WARN_AND_CHOOSE';

type LeadSlaSnapshot = {
  stageEnteredAt: Date | null;
  stageExpiresAt: Date | null;
  slaAction: SlaAction | null;
  slaWarningDays: number | null;
};

type LeadIncludeRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  expectedRevenue: number | null;
  generatedRevenue: number;
  assignedToId: string | null;
  stageId: string | null;
  lifecycleId: string | null;
  sourceId: string | null;
  nextFollowUpAt: Date | null;
  stageEnteredAt: Date | null;
  stageExpiresAt: Date | null;
  slaAction: SlaAction | null;
  slaWarningDays: number | null;
  approvalState: 'NONE' | 'PENDING';
  pendingApprovalToStageId: string | null;
  pendingApprovalRequestedAt: Date | null;
  isClosed: boolean;
  isLOB: boolean;
  closedAt: Date | null;
  closedById: string | null;
  closureType: 'WON' | 'LOST' | 'CANCELLED' | null;
  workspaceId: string;
  createdById: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedTo: { id: string; name: string | null; username: string | null; email: string } | null;
  stage: { id: string; name: string; color: string; isLOB: boolean; isClosed: boolean } | null;
  lifecycle: { id: string; name: string; isDefault: boolean } | null;
  source: { id: string; name: string; status: string } | null;
  createdBy: { id: string; name: string | null; username: string | null; email: string };
  closedBy: { id: string; name: string | null; username: string | null; email: string } | null;
  lobLogs: Array<{
    id: string;
    reasonId: string;
    remarks: string | null;
    changedById: string;
    changedAt: Date;
  }>;
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

const isManagerialRole = (role?: string | null): boolean => {
  const normalized = normalizeRoleKey(role);
  return normalized === 'admin' || normalized === 'superadmin' || normalized === 'manager';
};

const resolveDisplayName = (user: { name: string | null; username: string | null; email: string }): string => {
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email;
};

const leadInclude = {
  assignedTo: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  stage: {
    select: {
      id: true,
      name: true,
      color: true,
      isLOB: true,
      isClosed: true,
    },
  },
  lifecycle: {
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  },
  source: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  closedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  lobLogs: {
    orderBy: { changedAt: 'desc' as const },
    take: 5,
    select: {
      id: true,
      reasonId: true,
      remarks: true,
      changedById: true,
      changedAt: true,
    },
  },
} as const;

const hasGeneratedDelegates = (): boolean => {
  const lead = (prisma as any).lead;
  const leadLobLog = (prisma as any).leadLOBLog;
  const followUp = (prisma as any).followUp;
  return Boolean(
    lead?.findFirst &&
      lead?.findMany &&
      lead?.create &&
      lead?.update &&
      leadLobLog?.create &&
      followUp?.create,
  );
};

const assertModuleReady = async (): Promise<void> => {
  const leadTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.leads')::text AS table_name
  `;
  const lobTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT to_regclass('public.lead_lob_logs')::text AS table_name
  `;

  if (!leadTable[0]?.table_name || !lobTable[0]?.table_name) {
    throw createServiceError(
      'Leads module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Leads module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const mapLeadRecord = (lead: LeadIncludeRecord) => ({
  ...lead,
  nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null,
  stageEnteredAt: lead.stageEnteredAt ? lead.stageEnteredAt.toISOString() : null,
  stageExpiresAt: lead.stageExpiresAt ? lead.stageExpiresAt.toISOString() : null,
  pendingApprovalRequestedAt: lead.pendingApprovalRequestedAt ? lead.pendingApprovalRequestedAt.toISOString() : null,
  closedAt: lead.closedAt ? lead.closedAt.toISOString() : null,
  deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
  createdAt: lead.createdAt.toISOString(),
  updatedAt: lead.updatedAt.toISOString(),
  slaState: (() => {
    if (!lead.stageExpiresAt || !lead.slaAction || lead.isClosed || lead.isLOB) return null;
    const now = Date.now();
    const expiresAt = lead.stageExpiresAt.getTime();
    if (expiresAt <= now) return 'EXPIRED' as const;
    if (lead.slaWarningDays !== null && lead.slaWarningDays !== undefined) {
      const warningAt = expiresAt - lead.slaWarningDays * 24 * 60 * 60 * 1000;
      if (warningAt <= now) return 'WARNING' as const;
    }
    return 'ON_TRACK' as const;
  })(),
  assignedTo: lead.assignedTo
    ? {
        ...lead.assignedTo,
        displayName: resolveDisplayName(lead.assignedTo),
      }
    : null,
  createdBy: {
    ...lead.createdBy,
    displayName: resolveDisplayName(lead.createdBy),
  },
  closedBy: lead.closedBy
    ? {
        ...lead.closedBy,
        displayName: resolveDisplayName(lead.closedBy),
      }
    : null,
  lobLogs: lead.lobLogs.map((item) => ({
    ...item,
    changedAt: item.changedAt.toISOString(),
  })),
});

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildLeadCacheKey = (workspaceId: string, query: ListLeadsQueryInput | ExportLeadsQueryInput): string =>
  `leads:${workspaceId}:${JSON.stringify(query)}`;

export const clearLeadCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isOpen) return;

  try {
    const keysToDelete: string[] = [];
    const pattern = `leads:${workspaceId}:*`;

    // Try scan iterator first (best for perf)
    for await (const key of (redisClient as any).scanIterator({ MATCH: pattern, COUNT: 250 })) {
      if (typeof key === 'string' && key.length > 0) {
        keysToDelete.push(key);
      }
    }

    // Fallback search if scan found nothing but we expect keys
    if (keysToDelete.length === 0) {
      const keys = await (redisClient as any).keys(pattern);
      if (Array.isArray(keys)) {
        keysToDelete.push(...keys);
      }
    }

    if (uniqueKeys.length > 0) {
      const uniqueKeysFinal = Array.from(new Set(uniqueKeys));
      await Promise.all(
        Array.from({ length: Math.ceil(uniqueKeysFinal.length / 50) }, (_, i) =>
          redisClient.del(uniqueKeysFinal.slice(i * 50, (i + 1) * 50)),
        ),
      );
    }
    
    // Tiny delay to allow Redis deletions to fully propagate through the cluster/event loop
    // and ensure subsequent GETs don't race and hit a stale shard or mid-delete key.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (error) {
    // Silently fail cache clearing to not block the main operation, but log it
    console.error('Failed to clear lead cache:', error);
  }
};

const ensureFutureFollowUp = (date?: Date | null): void => {
  if (!date) return;
  if (date.getTime() <= Date.now()) {
    throw createServiceError('nextFollowUpAt must be a future date.', 422);
  }
};

const ensureUserExistsInWorkspace = async (workspaceId: string, userId: string): Promise<void> => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      workspaceId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  if (!user) {
    throw createServiceError('Assigned user was not found in this workspace.', 404);
  }
};

const ensureAssignmentAllowed = (actor: Actor, assignedToId: string | null | undefined): void => {
  if (!assignedToId || assignedToId === actor.id) return;
  if (!isManagerialRole(actor.role?.name)) {
    throw createServiceError('You are not allowed to assign a lead to another user.', 403);
  }
};

const resolveAssignedUserId = async (
  workspaceId: string,
  assignedToId: string | null | undefined,
): Promise<string | null> => {
  if (!assignedToId) return null;
  await ensureUserExistsInWorkspace(workspaceId, assignedToId);
  return assignedToId;
};

const resolveStage = async (stageId: string | null | undefined) => {
  if (!stageId) return null;

  const stage = await prisma.leadStage.findFirst({
    where: {
      id: stageId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
    },
  });

  if (!stage) {
    throw createServiceError('Lead stage was not found.', 404);
  }

  return stage;
};

const resolveLifecycle = async (workspaceId: string, lifecycleId?: string | null) => {
  if (!lifecycleId) {
    return prisma.leadLifeCycle.findFirst({
      where: {
        workspaceId,
        isDefault: true,
      },
      select: {
        id: true,
        name: true,
        transitions: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: {
            fromStageId: true,
            numberOfDays: true,
            expiryAction: true,
            warningDays: true,
          },
        },
      },
    });
  }

  const lifecycle = await prisma.leadLifeCycle.findFirst({
    where: {
      id: lifecycleId,
      workspaceId,
    },
    select: {
      id: true,
      name: true,
      transitions: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          fromStageId: true,
          numberOfDays: true,
          expiryAction: true,
          warningDays: true,
        },
      },
    },
  });

  if (!lifecycle) {
    throw createServiceError('Lead lifecycle was not found in this workspace.', 404);
  }

  return lifecycle;
};

const emptySlaSnapshot = (): LeadSlaSnapshot => ({
  stageEnteredAt: null,
  stageExpiresAt: null,
  slaAction: null,
  slaWarningDays: null,
});

const addDays = (base: Date, days: number): Date => new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

const resolveLifecycleTransition = (
  lifecycle?:
    | {
        transitions?: Array<{
          numberOfDays: number;
          expiryAction: SlaAction;
          warningDays: number;
          fromStageId?: string | null;
        }>;
      }
    | null,
  stageId?: string | null,
): {
  numberOfDays: number;
  expiryAction: SlaAction;
  warningDays: number;
} | null => {
  const transitions = lifecycle?.transitions || [];
  if (transitions.length === 0 || !stageId) return null;
  const transition = transitions.find((item) => item.fromStageId === stageId) || transitions[0];
  if (!transition || transition.numberOfDays <= 0) return null;

  return {
    numberOfDays: transition.numberOfDays,
    expiryAction: transition.expiryAction || 'AUTO_LOB',
    warningDays: transition.warningDays ?? 0,
  };
};

const buildLeadSlaSnapshot = async (
  lifecycle?:
    | {
        transitions?: Array<{
          fromStageId?: string | null;
          numberOfDays: number;
          expiryAction: SlaAction;
          warningDays: number;
        }>;
      }
    | null,
  stageId?: string | null,
  fromDate = new Date(),
): Promise<LeadSlaSnapshot> => {
  const transition = resolveLifecycleTransition(lifecycle, stageId);
  if (!transition) return emptySlaSnapshot();

  return {
    stageEnteredAt: fromDate,
    stageExpiresAt: addDays(fromDate, transition.numberOfDays),
    slaAction: transition.expiryAction,
    slaWarningDays: transition.warningDays,
  };
};

const shouldRefreshSla = (
  existing: Pick<LeadIncludeRecord, 'stageId' | 'lifecycleId'>,
  nextStageId?: string | null,
  nextLifecycleId?: string | null,
): boolean => existing.stageId !== (nextStageId ?? null) || existing.lifecycleId !== (nextLifecycleId ?? null);

const shouldRequireApprovalForStage = (
  stage?: { isApprovalRequired?: boolean | null; isClosed?: boolean | null; name?: string | null } | null,
): boolean => Boolean(stage?.isApprovalRequired);

const sweepThrottleByWorkspace = new Map<string, number>();

const shouldRunSweepNow = (workspaceId: string): boolean => {
  const now = Date.now();
  const lastRunAt = sweepThrottleByWorkspace.get(workspaceId) || 0;
  if (now - lastRunAt < LEADS_CACHE_TTL_SECONDS * 1000) return false;
  sweepThrottleByWorkspace.set(workspaceId, now);
  return true;
};

const getLobStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ isLOB: true }, { name: { equals: 'LOB', mode: 'insensitive' } }],
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      isLOB: true,
      isClosed: true,
    },
  });

const getDefaultStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      deletedAt: null,
      status: 'ACTIVE',
      isLOB: false,
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      isApprovalRequired: true,
      isLOB: true,
      isClosed: true,
    },
  });

const maybeRunLeadSlaSweep = async (workspaceId: string): Promise<void> => {
  if (!shouldRunSweepNow(workspaceId)) return;

  const expiredAutoLobLeads = await prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      isClosed: false,
      isLOB: false,
      stageExpiresAt: { lte: new Date() },
      slaAction: 'AUTO_LOB',
    },
    select: {
      id: true,
    },
    take: 100,
  });

  if (expiredAutoLobLeads.length === 0) return;

  const lobStage = await getLobStageForWorkspace(workspaceId);
  if (!lobStage) return;

  for (const lead of expiredAutoLobLeads) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await (tx as any).lead.update({
        where: { id: lead.id },
        data: {
          stageId: lobStage.id,
          isLOB: true,
          isClosed: true,
          closedAt: now,
          closureType: 'LOST',
          stageEnteredAt: now,
          stageExpiresAt: null,
          slaAction: null,
          slaWarningDays: null,
        },
      });

      await (tx as any).leadLOBLog.create({
        data: {
          leadId: lead.id,
          reasonId: 'SYSTEM_SLA_EXPIRED',
          remarks: 'Moved automatically to LOB after stage SLA expired.',
          changedById: 'system',
          workspaceId,
        },
      });
    });
  }

  await clearLeadCache(workspaceId);
};

const resolveSource = async (sourceId: string | null | undefined) => {
  if (!sourceId) return null;

  const source = await prisma.leadSource.findFirst({
    where: {
      id: sourceId,
      deletedAt: null,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!source) {
    throw createServiceError('Lead source was not found.', 404);
  }

  return source;
};

const ensureLOBPayload = (stage: { isLOB: boolean; name: string } | null, reasonId?: string | null, remarks?: string | null): void => {
  const isLobStage = Boolean(stage?.isLOB || normalizeRoleKey(stage?.name) === 'lob');
  if (!isLobStage) return;

  if (!reasonId) {
    throw createServiceError('reasonId is required when moving a lead to LOB.', 422);
  }
};

const ensureValidLOBReasonForStage = async (
  workspaceId: string,
  stage: { isLOB: boolean; name: string } | null,
  reasonId?: string | null,
): Promise<void> => {
  const isLobStage = Boolean(stage?.isLOB || normalizeRoleKey(stage?.name) === 'lob');
  if (!isLobStage || !reasonId) return;

  await assertActiveLOBReason(workspaceId, reasonId);
};

const findDuplicateLead = async (
  workspaceId: string,
  email?: string | null,
  phone?: string | null,
  excludeId?: string,
): Promise<void> => {
  const normalizedEmail = email?.trim() || null;
  const normalizedPhone = phone?.trim() || null;
  const filters = [];
  if (normalizedEmail) filters.push({ email: normalizedEmail });
  if (normalizedPhone) filters.push({ phone: normalizedPhone });
  if (filters.length === 0) return;

  const duplicate = await (prisma as any).lead.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      OR: filters,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true, email: true, phone: true },
  });

  if (duplicate) {
    const conflicts: string[] = [];
    if (normalizedEmail && duplicate.email?.trim().toLowerCase() === normalizedEmail.toLowerCase()) {
      conflicts.push(`email "${normalizedEmail}"`);
    }
    if (normalizedPhone && duplicate.phone?.trim() === normalizedPhone) {
      conflicts.push(`phone "${normalizedPhone}"`);
    }

    const duplicateLabel = duplicate.name?.trim() || 'another lead';
    const conflictSummary = conflicts.length > 0 ? conflicts.join(' and ') : 'the same email or phone';
    throw createServiceError(
      `A lead already exists with ${conflictSummary}. Please review "${duplicateLabel}" or use different contact details.`,
      409,
    );
  }
};

const buildListWhere = (workspaceId: string, query: ListLeadsQueryInput | ExportLeadsQueryInput) => {
  const where: any = {
    workspaceId,
  };

  if (query.status === 'ARCHIVED') {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { phone: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  if (query.assignedTo) where.assignedToId = query.assignedTo;
  if (query.stage) where.stageId = query.stage;
  if (query.source) where.sourceId = query.source;

  if (query.status === 'OPEN') {
    where.isClosed = false;
  } else if (query.status === 'CLOSED') {
    where.isClosed = true;
  } else if (query.status === 'LOB') {
    where.isLOB = true;
  } else if (query.status === 'ACTIVE') {
    where.isClosed = false;
    where.isLOB = false;
  }

  return where;
};

const getLeadScoped = async (workspaceId: string, id: string) => {
  const lead = await (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    include: leadInclude,
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  return lead as LeadIncludeRecord;
};

const createAutomaticFollowUp = async (
  tx: any,
  leadId: string,
  workspaceId: string,
  userId: string,
  scheduledAt: Date,
  description?: string,
): Promise<void> => {
  await (tx as any).followUp.create({
    data: {
      leadId,
      userId,
      workspaceId,
      type: 'CALL',
      description: description?.trim() || 'Auto-created from lead workflow',
      status: 'PENDING',
      scheduledAt,
    },
  });
};

export const createLead = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLeadInput,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();
  ensureFutureFollowUp(input.nextFollowUpAt);

  await findDuplicateLead(workspaceId, input.email ?? null, input.phone ?? null);

  ensureAssignmentAllowed(actor, input.assignedToId);
  const assignedToId = await resolveAssignedUserId(workspaceId, input.assignedToId);
  const stage = (await resolveStage(input.stageId)) || (await getDefaultStageForWorkspace(workspaceId)) || null;
  const lifecycle = await resolveLifecycle(workspaceId, input.lifecycleId);
  const source = await resolveSource(input.sourceId);
  ensureLOBPayload(stage, input.reasonId, input.remarks ?? null);
  await ensureValidLOBReasonForStage(workspaceId, stage, input.reasonId);
  const slaSnapshot = stage?.isLOB || stage?.isClosed
    ? emptySlaSnapshot()
    : await buildLeadSlaSnapshot(lifecycle, stage?.id || null);

  const createdLeadId = await prisma.$transaction(async (tx) => {
    const closureData = buildClosureUpdateData(stage, actor.id);

    const lead = await (tx as any).lead.create({
      data: {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        expectedRevenue: input.expectedRevenue ?? null,
        assignedToId,
        stageId: stage?.id || null,
        lifecycleId: lifecycle?.id || null,
        sourceId: source?.id || null,
        nextFollowUpAt: input.nextFollowUpAt ?? null,
        stageEnteredAt: slaSnapshot.stageEnteredAt,
        stageExpiresAt: slaSnapshot.stageExpiresAt,
        slaAction: slaSnapshot.slaAction,
        slaWarningDays: slaSnapshot.slaWarningDays,
        isClosed: Boolean(stage?.isLOB) ? true : closureData.isClosed,
        isLOB: Boolean(stage?.isLOB),
        closedAt: closureData.closedAt,
        closedById: closureData.closedById,
        closureType: closureData.closureType,
        generatedRevenue: closureData.generatedRevenue,
        workspaceId,
        createdById: actor.id,
      },
      include: leadInclude,
    });

    if (input.nextFollowUpAt) {
      await createAutomaticFollowUp(
        tx,
        lead.id,
        workspaceId,
        assignedToId || actor.id,
        input.nextFollowUpAt,
        input.followUpDescription,
      );
    }

    if (stage?.isLOB) {
      await (tx as any).leadLOBLog.create({
        data: {
          leadId: lead.id,
          reasonId: input.reasonId!,
          remarks: input.remarks?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    return lead.id;
  });

  await clearLeadCache(workspaceId);
  const created = await getLeadScoped(workspaceId, createdLeadId);
  return mapLeadRecord(created);
};

export const getLeads = async (
  workspaceId: string,
  query: ListLeadsQueryInput,
): Promise<{
  leads: Array<ReturnType<typeof mapLeadRecord>>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}> => {
  await assertModuleReady();
  await maybeRunLeadSlaSweep(workspaceId);

  const cacheKey = buildLeadCacheKey(workspaceId, query);
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const skip = (query.page - 1) * query.limit;
  const where = buildListWhere(workspaceId, query);

  const [total, rows] = await prisma.$transaction([
    (prisma as any).lead.count({ where }),
    (prisma as any).lead.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      include: leadInclude,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const result = {
    leads: (rows as LeadIncludeRecord[]).map(mapLeadRecord),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNext: query.page < totalPages,
      hasPrev: query.page > 1,
    },
  };

  if (redisClient.isOpen) {
    await redisClient.setEx(cacheKey, LEADS_CACHE_TTL_SECONDS, JSON.stringify(result));
  }

  return result;
};

export const getLeadById = async (
  workspaceId: string,
  id: string,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();
  await maybeRunLeadSlaSweep(workspaceId);
  const lead = await getLeadScoped(workspaceId, id);
  return mapLeadRecord(lead);
};

export const updateLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateLeadInput,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();

  const existing = await getLeadScoped(workspaceId, id);
  if (
    existing.approvalState === 'PENDING' &&
    input.stageId !== undefined &&
    input.stageId !== existing.stageId
  ) {
    throw createServiceError(
      'This lead has a pending stage approval request. Resolve it before changing the stage again.',
      409,
    );
  }

  const nextFollowUpAt = input.nextFollowUpAt === null ? null : (input.nextFollowUpAt ?? existing.nextFollowUpAt);
  ensureFutureFollowUp(nextFollowUpAt);

  const email = input.email === null ? null : input.email?.trim() ?? existing.email;
  const phone = input.phone === null ? null : input.phone?.trim() ?? existing.phone;
  await findDuplicateLead(workspaceId, email, phone, id);

  const assignedToId = input.assignedToId !== undefined
    ? (ensureAssignmentAllowed(actor, input.assignedToId), await resolveAssignedUserId(workspaceId, input.assignedToId))
    : existing.assignedToId;
  const stage = input.stageId !== undefined ? await resolveStage(input.stageId) : existing.stage;
  const lifecycle = input.lifecycleId !== undefined ? await resolveLifecycle(workspaceId, input.lifecycleId) : existing.lifecycle;
  const source = input.sourceId !== undefined ? await resolveSource(input.sourceId) : existing.source;
  const lifecycleForSla =
    input.lifecycleId !== undefined
      ? lifecycle
      : input.stageId !== undefined && existing.lifecycleId
        ? await resolveLifecycle(workspaceId, existing.lifecycleId)
        : null;

  if (
    input.stageId !== undefined &&
    stage?.id &&
    existing.stageId &&
    stage.id !== existing.stageId &&
    shouldRequireApprovalForStage(stage)
  ) {
    throw createServiceError(
      'This stage change requires approval. Use the stage transition flow instead of a direct lead update.',
      409,
    );
  }

  const remarks = input.remarks === null ? null : input.remarks ?? null;
  const reasonId = input.reasonId === null ? null : input.reasonId ?? null;
  ensureLOBPayload(stage, reasonId, remarks);
  await ensureValidLOBReasonForStage(workspaceId, stage, reasonId);
  const closureData = input.stageId !== undefined
    ? buildClosureUpdateData(stage as any, actor.id, {
        isClosed: existing.isClosed,
        closedAt: existing.closedAt,
        closedById: existing.closedById,
        generatedRevenue: existing.generatedRevenue,
        closureType: existing.closureType as any,
      })
    : {
        isClosed: existing.isClosed,
        closedAt: existing.closedAt,
        closedById: existing.closedById,
        closureType: existing.closureType as any,
        generatedRevenue: existing.generatedRevenue,
      };
  const nextStageId = stage?.id || null;
  const nextLifecycleId = lifecycle?.id || null;
  const nextLifecycleForSla =
    lifecycleForSla && 'transitions' in lifecycleForSla
      ? { transitions: lifecycleForSla.transitions }
      : null;
  const slaSnapshot = shouldRefreshSla(existing, nextStageId, nextLifecycleId)
    ? (stage?.isLOB || isClosureStage(stage)
        ? emptySlaSnapshot()
        : await buildLeadSlaSnapshot(nextLifecycleForSla, nextStageId))
    : {
        stageEnteredAt: existing.stageEnteredAt,
        stageExpiresAt: existing.stageExpiresAt,
        slaAction: existing.slaAction,
        slaWarningDays: existing.slaWarningDays,
      };

  const updatedLeadId = await prisma.$transaction(async (tx) => {
    await (tx as any).lead.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email } : {}),
        ...(input.phone !== undefined ? { phone } : {}),
        ...(input.expectedRevenue !== undefined
          ? { expectedRevenue: input.expectedRevenue === null ? null : input.expectedRevenue }
          : {}),
        ...(input.assignedToId !== undefined ? { assignedToId } : {}),
        ...(input.stageId !== undefined ? { stageId: stage?.id || null } : {}),
        ...(input.lifecycleId !== undefined ? { lifecycleId: lifecycle?.id || null } : {}),
        ...(input.sourceId !== undefined ? { sourceId: source?.id || null } : {}),
        ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt } : {}),
        ...(shouldRefreshSla(existing, nextStageId, nextLifecycleId)
          ? {
              stageEnteredAt: slaSnapshot.stageEnteredAt,
              stageExpiresAt: slaSnapshot.stageExpiresAt,
              slaAction: slaSnapshot.slaAction,
              slaWarningDays: slaSnapshot.slaWarningDays,
            }
          : {}),
        ...(input.isClosed !== undefined ? { isClosed: input.isClosed } : {}),
        isLOB: Boolean(stage?.isLOB),
        ...(stage
          ? {
              isClosed: Boolean(stage.isLOB) ? true : closureData.isClosed,
              closedAt: closureData.closedAt,
              closedById: closureData.closedById,
              closureType: closureData.closureType,
              generatedRevenue: closureData.generatedRevenue,
            }
          : {}),
      },
    });

    if (input.nextFollowUpAt && (!existing.nextFollowUpAt || existing.nextFollowUpAt.getTime() !== input.nextFollowUpAt.getTime())) {
      await createAutomaticFollowUp(
        tx,
        id,
        workspaceId,
        assignedToId || actor.id,
        input.nextFollowUpAt,
        input.followUpDescription,
      );
    }

    if (stage?.isLOB && (existing.stageId !== stage.id || !existing.isLOB)) {
      await (tx as any).leadLOBLog.create({
        data: {
          leadId: id,
          reasonId: reasonId!,
          remarks: remarks?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    return id;
  });

  await clearLeadCache(workspaceId);
  const updated = await getLeadScoped(workspaceId, updatedLeadId);
  return mapLeadRecord(updated);
};

export const changeStage = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: ChangeStageInput,
): Promise<
  | { approvalRequired: false; lead: ReturnType<typeof mapLeadRecord> }
  | { approvalRequired: true; lead: any; approval: any }
> => {
  await assertModuleReady();

  const existing = await getLeadScoped(workspaceId, id);
  const targetStage = await resolveStage(input.stageId);

  if (!targetStage) {
    throw createServiceError('Lead stage was not found.', 404);
  }

  ensureLOBPayload(targetStage, input.reasonId, input.remarks ?? null);
  await ensureValidLOBReasonForStage(workspaceId, targetStage, input.reasonId);

  if (existing.stageId !== targetStage.id && shouldRequireApprovalForStage(targetStage)) {
    if (!existing.stageId) {
      throw createServiceError('Lead does not have a current stage to request approval from.', 409);
    }

    const result = await leadApprovalService.createLeadApproval(
      workspaceId,
      { id: actor.id, roleId: actor.roleId ?? null, role: actor.role },
      {
        leadId: id,
        fromStageId: existing.stageId,
        toStageId: targetStage.id,
        requestData: {
          reasonId: input.reasonId ?? null,
          remarks: input.remarks ?? null,
          nextFollowUpAt: input.nextFollowUpAt ? input.nextFollowUpAt.toISOString() : null,
          followUpDescription: input.followUpDescription ?? null,
        },
      },
    );

    return {
      approvalRequired: true,
      lead: result.lead,
      approval: result.approval,
    };
  }

  const updatedLead = await updateLead(workspaceId, actor, id, {
    stageId: input.stageId,
    reasonId: input.reasonId,
    remarks: input.remarks,
    nextFollowUpAt: input.nextFollowUpAt,
    followUpDescription: input.followUpDescription,
  });

  return {
    approvalRequired: false,
    lead: updatedLead,
  };
};

export const assignLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: AssignLeadInput,
): Promise<ReturnType<typeof mapLeadRecord>> =>
  updateLead(workspaceId, actor, id, {
    assignedToId: input.assignedToId,
  });

export const extendLeadSla = async (
  workspaceId: string,
  id: string,
  extraDays: number,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();

  const lead = await getLeadScoped(workspaceId, id);
  if (lead.isClosed || lead.isLOB) {
    throw createServiceError('Only active leads can have their lifecycle timer extended.', 409);
  }

  if (!lead.stageExpiresAt) {
    throw createServiceError('This lead does not have an active lifecycle timer to extend.', 409);
  }

  if (lead.slaAction !== 'WARN_AND_CHOOSE') {
    throw createServiceError('This lead is configured to move to LOB automatically on expiry.', 409);
  }

  const updated = await (prisma as any).lead.update({
    where: { id },
    data: {
      stageExpiresAt: addDays(lead.stageExpiresAt, extraDays),
    },
    include: leadInclude,
  });

  await clearLeadCache(workspaceId);
  return mapLeadRecord(updated as LeadIncludeRecord);
};

export const deleteLead = async (workspaceId: string, id: string): Promise<void> => {
  await assertModuleReady();

  const lead = await (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: {
      id: true,
      deletedAt: true,
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  if (lead.deletedAt) {
    await clearLeadCache(workspaceId);
    return;
  }

  await (prisma as any).lead.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await clearLeadCache(workspaceId);
};

export const permanentlyDeleteLead = async (workspaceId: string, id: string): Promise<void> => {
  await assertModuleReady();

  const lead = await (prisma as any).lead.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: {
      id: true,
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  await prisma.$transaction(async (tx) => {
    await (tx as any).leadDynamicValue.deleteMany({
      where: {
        leadId: id,
      },
    });

    await (tx as any).lead.update({
      where: { id },
      data: {
        name: `Deleted Lead ${id.slice(-6)}`,
        email: null,
        phone: null,
        expectedRevenue: null,
        generatedRevenue: 0,
        assignedToId: null,
        stageId: null,
        lifecycleId: null,
        sourceId: null,
        nextFollowUpAt: null,
        stageEnteredAt: null,
        stageExpiresAt: null,
        slaAction: null,
        slaWarningDays: null,
        approvalState: 'NONE',
        pendingApprovalToStageId: null,
        pendingApprovalRequestedAt: null,
        isClosed: false,
        isLOB: false,
        closedAt: null,
        closedById: null,
        closureType: null,
        deletedAt: new Date(),
      },
    });
  });

  await clearLeadCache(workspaceId);
};

export const bulkDeleteLeads = async (workspaceId: string, ids: string[], permanent: boolean = false): Promise<void> => {
  await assertModuleReady();

  if (!ids || ids.length === 0) return;

  // Clear cache BEFORE 
  await clearLeadCache(workspaceId);

  if (permanent) {
    await prisma.$transaction(async (tx) => {
      // 1. Delete associated dynamic values first
      await (tx as any).leadDynamicValue.deleteMany({
        where: { leadId: { in: ids } },
      });

      // 2. Performance: Use updateMany instead of individual updates to avoid timeout
      await (tx as any).lead.updateMany({
        where: { id: { in: ids }, workspaceId },
        data: {
          email: null,
          phone: null,
          expectedRevenue: null,
          generatedRevenue: 0,
          assignedToId: null,
          stageId: null,
          lifecycleId: null,
          sourceId: null,
          nextFollowUpAt: null,
          stageEnteredAt: null,
          stageExpiresAt: null,
          slaAction: null,
          slaWarningDays: null,
          approvalState: 'NONE',
          pendingApprovalToStageId: null,
          pendingApprovalRequestedAt: null,
          isClosed: false,
          isLOB: false,
          closedAt: null,
          closedById: null,
          closureType: null,
          deletedAt: new Date(),
        },
      });
    }, { 
      // Increase timeout to 30s to be safe for large batches
      timeout: 30000 
    });
  } else {
    // Standard archiving is fast with updateMany
    await (prisma as any).lead.updateMany({
      where: { id: { in: ids }, workspaceId },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  // Clear cache AFTER
  // We keep the tiny delay for consistency, then wipe the cache
  await new Promise((resolve) => setTimeout(resolve, 150));
  await clearLeadCache(workspaceId);
};

export const exportLeads = async (
  workspaceId: string,
  query: ExportLeadsQueryInput,
): Promise<{ filename: string; content: string; contentType: string }> => {
  await assertModuleReady();

  const where = buildListWhere(workspaceId, query);
  const rows = await (prisma as any).lead.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    include: leadInclude,
  });

  const headers = [
    'Lead ID',
    'Name',
    'Email',
    'Phone',
    'Expected Revenue',
    'Assigned To',
    'Stage',
    'Lifecycle',
    'Source',
    'Next Follow Up At',
    'Is Closed',
    'Is LOB',
    'Created By',
    'Created At',
    'Updated At',
  ];

  const lines = (rows as LeadIncludeRecord[]).map((lead) => [
    lead.id,
    lead.name,
    lead.email || '',
    lead.phone || '',
    lead.expectedRevenue ?? '',
    lead.assignedTo ? resolveDisplayName(lead.assignedTo) : '',
    lead.stage?.name || '',
    lead.lifecycle?.name || '',
    lead.source?.name || '',
    lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : '',
    lead.isClosed ? 'Yes' : 'No',
    lead.isLOB ? 'Yes' : 'No',
    resolveDisplayName(lead.createdBy),
    lead.createdAt.toISOString(),
    lead.updatedAt.toISOString(),
  ]);

  const content = [headers, ...lines].map((row) => row.map(escapeCsv).join(',')).join('\n');
  return {
    filename: `leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
    content,
    contentType: 'text/csv; charset=utf-8',
  };
};

export const canAssignOtherUsers = (actor: Actor): boolean => isManagerialRole(actor.role?.name);
