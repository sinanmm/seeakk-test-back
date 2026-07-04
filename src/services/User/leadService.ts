import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import logger from '../../utils/logger';
import { normalizeFollowUpType } from '../../constants/followUpType';
import { buildAccessWhere, buildClosureUpdateData, isClosureStage, resolveLeadVisibilityMode } from '../../modules/leads/leads.service';
import { buildLeadOutcomeFlagsFromStage, isClosedWonStage, isLobStage } from '../../modules/leads/leadVisibility.util';
import * as leadApprovalService from '../../modules/leads/leadApprovals.service';
import { validateLeadStageTransition } from '../../modules/master/lead-stages/leadStage.service';
import { getActiveStageRulesForExecution } from '../../modules/master/stage-rules/stageRule.service';
import { assertActiveLOBReason } from '../../modules/master/lob-reasons/lobReasons.service';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExportLeadsQueryInput,
  ListLeadsQueryInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';
import { touchFollowUpTodayCachesAfterLeadMutation } from './followupService';

import { hasPermission } from '../../middlewares/authMiddleware';

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
  companyName: string | null;
  address: string | null;
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
  assignedTo: { id: string; name: string | null; username: string | null; email: string; supervisorId: string | null } | null;
  stage: { id: string; name: string; color: string; isLOB: boolean; isClosed: boolean } | null;
  lifecycle: { id: string; name: string; isDefault: boolean } | null;
  source: { id: string; name: string; status: string } | null;
  createdBy: { id: string; name: string | null; username: string | null; email: string };
  closedBy: { id: string; name: string | null; username: string | null; email: string } | null;
  followUps: Array<{
    id: string;
    type: string;
    description: string | null;
    scheduledAt: Date;
    status: string;
  }>;
  lobLogs: Array<{
    id: string;
    reasonId: string;
    remarks: string | null;
    previousStageId: string | null;
    previousStageName: string | null;
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

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string } | null): string => {
  if (!user) return '';
  if (user.name && user.name.trim()) return user.name.trim();
  if (user.username && user.username.trim()) return user.username.trim();
  return user.email || '';
};

const leadInclude = {
  assignedTo: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      supervisorId: true,
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
  followUps: {
    orderBy: [{ scheduledAt: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 10,
    select: {
      id: true,
      type: true,
      description: true,
      scheduledAt: true,
      status: true,
    },
  },
} as const;

const hasGeneratedDelegates = (): boolean => {
  const lead = (prisma as any).lead;
  const followUp = (prisma as any).followUp;
  return Boolean(
    lead?.findFirst &&
      lead?.findMany &&
      lead?.create &&
      lead?.update &&
      followUp?.create,
  );
};

/**
 * Scalar columns on public.leads required by the current Prisma `Lead` model (@@map("leads")).
 * Keep in sync with prisma/schema.prisma — if a migration adds a column, add it here so production
 * returns a clear 503 instead of a generic Prisma P2022 at query time.
 */
const LEAD_MODEL_DB_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'companyName',
  'address',
  'expectedRevenue',
  'generatedRevenue',
  'assignedToId',
  'stageId',
  'lifecycleId',
  'sourceId',
  'nextFollowUpAt',
  'stageEnteredAt',
  'stageExpiresAt',
  'slaAction',
  'slaWarningDays',
  'approvalState',
  'pendingApprovalToStageId',
  'pendingApprovalRequestedAt',
  'isClosed',
  'isLOB',
  'closedAt',
  'closedById',
  'closureType',
  'workspaceId',
  'createdById',
  'deletedAt',
  'createdAt',
  'updatedAt',
] as const;

let leadsColumnCheckValidUntil = 0;
const LEADS_COLUMN_CHECK_TTL_MS = 60_000;

const ensureLeadsColumnsMatchPrismaModel = async (): Promise<void> => {
  if (Date.now() < leadsColumnCheckValidUntil) {
    return;
  }

  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  const present = new Set(rows.map((row) => row.column_name.toLowerCase()));
  const missing = LEAD_MODEL_DB_COLUMNS.filter((col) => !present.has(col.toLowerCase()));

  if (missing.length > 0) {
    const companyOrAddress = missing.filter((c) => c === 'companyName' || c === 'address');
    const companyHint =
      companyOrAddress.length > 0
        ? ' Recent UI expects company/address: apply migration `20260420140000_lead_company_address` (included in repo migrations).'
        : '';

    throw createServiceError(
      `Leads module is not ready: table "leads" is missing column(s): ${missing.join(', ')}.` +
        ' On the server that uses this DATABASE_URL, run `npx prisma migrate deploy`, then restart the API.' +
        companyHint,
      503,
    );
  }

  leadsColumnCheckValidUntil = Date.now() + LEADS_COLUMN_CHECK_TTL_MS;
};

const assertModuleReady = async (): Promise<void> => {
  const leadTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = current_schema() AND table_name = 'leads'
  `;

  if (!leadTable[0]?.table_name) {
    throw createServiceError(
      'Leads module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }

  await ensureLeadsColumnsMatchPrismaModel();

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Leads module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const resolveNextFollowUpType = (lead: LeadIncludeRecord): 'CALL' | 'VISIT' | 'MEETING' | null => {
  if (!lead.nextFollowUpAt) return null;
  const targetMs = lead.nextFollowUpAt.getTime();
  const match = lead.followUps.find(
    (item) => item.status === 'PENDING' && item.scheduledAt.getTime() === targetMs,
  );
  if (match?.type) {
    return normalizeFollowUpType(match.type);
  }
  return 'CALL';
};

const mapLeadRecord = (lead: LeadIncludeRecord) => {
  const { followUps, ...rest } = lead;
  return {
    ...rest,
    nextFollowUpAt: lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : null,
    nextFollowUpType: resolveNextFollowUpType(lead),
    stageEnteredAt: lead.stageEnteredAt ? lead.stageEnteredAt.toISOString() : null,
    stageExpiresAt: lead.stageExpiresAt ? lead.stageExpiresAt.toISOString() : null,
    pendingApprovalRequestedAt: lead.pendingApprovalRequestedAt ? lead.pendingApprovalRequestedAt.toISOString() : null,
    closedAt: lead.closedAt ? lead.closedAt.toISOString() : null,
    deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    followUpDescription:
      followUps.find((item) => typeof item.description === 'string' && item.description.trim().length > 0)?.description || null,
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
  lobLogs: ((lead as any).lobLogs || []).map((item: any) => ({
    ...item,
    changedAt: item.changedAt.toISOString(),
  })),
  };
};

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildLeadCacheKey = (workspaceId: string, query: ListLeadsQueryInput | ExportLeadsQueryInput, actor?: Actor): string =>
  `leads:${workspaceId}:${actor ? `${actor.id}:${actor.roleId ?? 'no-role'}:` : ''}${JSON.stringify(query)}`;

const isLeadVisibilityDebugEnabled = (): boolean => process.env.LEAD_VISIBILITY_DEBUG === 'true';

const logLeadVisibilityDebug = async ({
  workspaceId,
  actor,
  query,
  filteredTotal,
  responseCount,
}: {
  workspaceId: string;
  actor?: Actor;
  query: ListLeadsQueryInput;
  filteredTotal: number;
  responseCount: number;
}): Promise<void> => {
  if (!isLeadVisibilityDebugEnabled()) return;

  let scope = 'anonymous';
  let permissionScopedTotal = 0;
  const workspaceTotal = await (prisma as any).lead.count({
    where: {
      workspaceId,
      deletedAt: null,
    },
  });

  if (actor) {
    try {
      scope = await resolveLeadVisibilityMode(workspaceId, actor);
      const accessWhere = await buildAccessWhere(workspaceId, actor);
      permissionScopedTotal = await (prisma as any).lead.count({
        where: {
          workspaceId,
          deletedAt: null,
          ...(Object.keys(accessWhere).length > 0 ? { AND: [accessWhere] } : {}),
        },
      });
    } catch {
      scope = 'none';
      permissionScopedTotal = 0;
    }
  } else {
    scope = 'all';
    permissionScopedTotal = workspaceTotal;
  }

  logger.info('Lead visibility debug snapshot', {
    action: 'lead_visibility_debug',
    workspaceId,
    actorId: actor?.id,
    roleId: actor?.roleId,
    scope,
    workspaceTotal,
    permissionScopedTotal,
    filteredTotal,
    responseCount,
    query,
  });
};

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
        keys.forEach(k => {
          if (typeof k === 'string' && k.length > 0) keysToDelete.push(k);
        });
      }
    }

    if (keysToDelete.length > 0) {
      const uniqueKeysFinal = Array.from(new Set(keysToDelete));
      // Process in batches of 50 to avoid blocking Redis or hitting payload limits
      for (let i = 0; i < uniqueKeysFinal.length; i += 50) {
        const batch = uniqueKeysFinal.slice(i, i + 50);
        await redisClient.del(batch);
      }
    }
    
    // Tiny delay to allow Redis deletions to fully propagate
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (error) {
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

const actorCanAssignToOthers = async (actor: Actor): Promise<boolean> =>
  hasPermission(actor, 'LEADS_ASSIGN');

const ensureAssignmentAllowed = async (
  actor: Actor,
  assignedToId: string | null | undefined,
): Promise<void> => {
  if (!assignedToId || assignedToId === actor.id) return;
  const canAssign = await actorCanAssignToOthers(actor);
  if (!canAssign) {
    throw createServiceError('You are not allowed to assign a lead to another user.', 403);
  }
};

const ensureAssignmentUpdateAllowed = async (
  actor: Actor,
  currentAssignedToId: string | null | undefined,
  nextAssignedToId: string | null | undefined,
): Promise<void> => {
  const current = currentAssignedToId ?? null;
  const next = nextAssignedToId ?? null;

  if (current === next) return;
  if (next === actor.id) return;

  const canAssign = await actorCanAssignToOthers(actor);
  if (!canAssign) {
    throw createServiceError('You are not allowed to change the lead owner.', 403);
  }
};

const resolveCreateAssignedToId = async (
  workspaceId: string,
  actor: Actor,
  inputAssignedToId: string | null | undefined,
): Promise<{ assignedToId: string | null; autoSelfAssigned: boolean }> => {
  const canAssignToOthers = await actorCanAssignToOthers(actor);

  if (!canAssignToOthers) {
    if (inputAssignedToId && inputAssignedToId !== actor.id) {
      throw createServiceError('You are not allowed to assign a lead to another user.', 403);
    }
    await ensureUserExistsInWorkspace(workspaceId, actor.id);
    return { assignedToId: actor.id, autoSelfAssigned: true };
  }

  await ensureAssignmentAllowed(actor, inputAssignedToId);
  const assignedToId = await resolveAssignedUserId(workspaceId, inputAssignedToId);
  return { assignedToId, autoSelfAssigned: false };
};

const resolveAssignedUserId = async (
  workspaceId: string,
  assignedToId: string | null | undefined,
): Promise<string | null> => {
  if (!assignedToId) return null;
  await ensureUserExistsInWorkspace(workspaceId, assignedToId);
  return assignedToId;
};

const resolveStage = async (workspaceId: string, stageId: string | null | undefined) => {
  if (!stageId) return null;

  const stage = await prisma.leadStage.findFirst({
    where: {
      id: stageId,
      workspaceId,
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
    // Lifecycle is opt-in per lead; do not auto-attach workspace default.
    return null;
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
  const transition = transitions.find((item) => item.fromStageId === stageId);
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
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      OR: [{ isLOB: true }, { name: { equals: 'LOB'} }],
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
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      isLOB: false,
      isClosed: false,
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

const getNewStageForWorkspace = async (_workspaceId: string) =>
  prisma.leadStage.findFirst({
    where: {
      workspaceId: _workspaceId,
      deletedAt: null,
      status: 'ACTIVE',
      isLOB: false,
      isClosed: false,
      OR: [
        { name: { equals: 'new'} },
        { name: { equals: 'new lead'} },
      ],
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

const maybeRunLeadSlaSweep = async (workspaceId: string | null | undefined): Promise<void> => {
  if (!workspaceId?.trim()) {
    logger.warn('Skipping lead SLA sweep because workspaceId is missing.', {
      action: 'lead_sla_sweep_skipped',
    });
    return;
  }

  if (!shouldRunSweepNow(workspaceId)) return;

  try {
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
        stageId: true,
        stage: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: 100,
    });

    if (expiredAutoLobLeads.length === 0) return;

    const lobStage = await getLobStageForWorkspace(workspaceId);
    if (!lobStage) return;

    for (const lead of expiredAutoLobLeads) {
      const now = new Date();
      await prisma.$transaction(async (tx: any) => {
        await (tx as any).lead.update({
          where: { id: lead.id },
          data: {
            stageId: lobStage.id,
            isLOB: true,
            isClosed: false,
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
            previousStageId: lead.stageId,
            previousStageName: lead.stage?.name?.trim() || null,
            changedById: 'system',
            workspaceId,
          },
        });
      });
    }

    await clearLeadCache(workspaceId);
  } catch (error: any) {
    sweepThrottleByWorkspace.delete(workspaceId);
    logger.error('Lead SLA sweep failed; continuing without blocking lead reads.', {
      action: 'lead_sla_sweep_failed',
      workspaceId,
      error: error?.message,
    });
  }
};

const resolveSource = async (workspaceId: string, sourceId: string | null | undefined) => {
  if (!sourceId) return null;

  const source = await prisma.leadSource.findFirst({
    where: {
      id: sourceId,
      workspaceId,
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

const normalizeRuleFieldKey = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const stageRuleValuesToAnswerMap = (
  entries?: Array<{ ruleId: string; value: string }>,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const entry of entries || []) {
    if (!entry?.ruleId?.trim()) continue;
    map[entry.ruleId.trim()] = typeof entry.value === 'string' ? entry.value : '';
  }
  return map;
};

const persistLeadStageRuleValues = async (
  leadId: string,
  entries?: Array<{ ruleId: string; value: string }>,
): Promise<void> => {
  if (!entries?.length) return;
  const rows = entries
    .filter((entry) => entry.ruleId?.trim() && entry.value?.trim())
    .map((entry) => ({
      leadId,
      ruleId: entry.ruleId.trim(),
      value: entry.value.trim(),
    }));
  if (!rows.length) return;
  await (prisma as any).leadStageInput.createMany({ data: rows });
};

type StageValidationPatch = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  address?: string | null;
  expectedRevenue?: number | null;
  assignedToId?: string | null;
  sourceId?: string | null;
  lifecycleId?: string | null;
  nextFollowUpAt?: Date | null;
  followUpDescription?: string | null;
  reasonId?: string | null;
  remarks?: string | null;
  stageId?: string | null;
};

const toValidationLeadData = async (
  lead: LeadIncludeRecord,
  patch: StageValidationPatch,
): Promise<Record<string, unknown>> => {
  const dynamicValues = await (prisma as any).leadDynamicValue.findMany({
    where: { leadId: lead.id },
    select: {
      value: true,
      field: {
        select: {
          name: true,
        },
      },
    },
  });

  const data: Record<string, unknown> = {
    name: patch.name ?? lead.name,
    email: patch.email !== undefined ? patch.email : lead.email,
    phone: patch.phone !== undefined ? patch.phone : lead.phone,
    companyName: patch.companyName !== undefined ? patch.companyName : lead.companyName,
    address: patch.address !== undefined ? patch.address : lead.address,
    expectedRevenue: patch.expectedRevenue !== undefined ? patch.expectedRevenue : lead.expectedRevenue,
    assignedToId: patch.assignedToId !== undefined ? patch.assignedToId : lead.assignedToId,
    sourceId: patch.sourceId !== undefined ? patch.sourceId : lead.sourceId,
    lifecycleId: patch.lifecycleId !== undefined ? patch.lifecycleId : lead.lifecycleId,
    nextFollowUpAt: patch.nextFollowUpAt !== undefined ? patch.nextFollowUpAt : lead.nextFollowUpAt,
    followUpDescription: patch.followUpDescription ?? undefined,
    reasonId: patch.reasonId !== undefined ? patch.reasonId : undefined,
    remarks: patch.remarks !== undefined ? patch.remarks : undefined,
  };

  Object.entries(data).forEach(([key, value]) => {
    data[normalizeRuleFieldKey(key)] = value;
  });

  for (const entry of dynamicValues) {
    const fieldName = entry?.field?.name?.trim();
    if (!fieldName) continue;
    data[fieldName] = entry.value;
    data[normalizeRuleFieldKey(fieldName)] = entry.value;
  }

  return data;
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

const buildListWhere = async (
  workspaceId: string,
  query: ListLeadsQueryInput | ExportLeadsQueryInput,
  actor?: Actor,
  options?: { includeArchived?: boolean },
) => {
  const where: any = {
    workspaceId,
  };

  if (actor) {
    const accessWhere = await buildAccessWhere(workspaceId, actor);
    if (accessWhere && Object.keys(accessWhere).length > 0) {
      where.AND = [accessWhere];
    }
  }

  const includeArchived = Boolean(options?.includeArchived);

  if (!includeArchived) {
    if (query.status === 'ARCHIVED') {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
  } else if (query.status === 'ARCHIVED') {
    where.deletedAt = { not: null };
  }

  if (query.search) {
    const searchCond = {
      OR: [
        { name: { contains: query.search} },
        { email: { contains: query.search} },
        { phone: { contains: query.search} },
      ],
    };
    if (where.AND) {
      where.AND.push(searchCond);
    } else {
      where.AND = [searchCond];
    }
  }

  if (query.assignedTo) where.assignedToId = query.assignedTo;
  if (query.stage) where.stageId = query.stage;
  if (query.source) where.sourceId = query.source;

  if (query.status === 'OPEN') {
    where.isClosed = false;
  } else if (query.status === 'CLOSED') {
    where.isClosed = true;
    where.isLOB = false;
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        NOT: {
          stage: {
            is: {
              isLOB: true,
            },
          },
        },
      },
    ];
  } else if (query.status === 'LOB') {
    where.isLOB = true;
  } else if (query.status === 'ACTIVE') {
    where.isClosed = false;
    where.isLOB = false;
  }

  return where;
};

const getLeadScoped = async (workspaceId: string, id: string, actor?: Actor) => {
  const where: any = {
    id,
    workspaceId,
    deletedAt: null,
  };

  if (actor) {
    const accessWhere = await buildAccessWhere(workspaceId, actor);
    if (accessWhere && Object.keys(accessWhere).length > 0) {
      where.AND = [accessWhere];
    }
  }

  const lead = await (prisma as any).lead.findFirst({
    where,
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
  followUpType: 'CALL' | 'VISIT' | 'MEETING' = 'CALL',
): Promise<void> => {
  const existingPending = await (tx as any).followUp.findFirst({
    where: { leadId, workspaceId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });

  if (existingPending) {
    await (tx as any).followUp.update({
      where: { id: existingPending.id },
      data: {
        userId,
        type: followUpType,
        description: description?.trim() || existingPending.description,
        scheduledAt,
      },
    });
  } else {
    await (tx as any).followUp.create({
      data: {
        leadId,
        userId,
        workspaceId,
        type: followUpType,
        description: description?.trim() || 'Auto-created from lead workflow',
        status: 'PENDING',
        scheduledAt,
      },
    });
  }
};

export const createLead = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLeadInput,
): Promise<{ lead: ReturnType<typeof mapLeadRecord>; autoSelfAssigned: boolean }> => {
  await assertModuleReady();
  ensureFutureFollowUp(input.nextFollowUpAt);

  await findDuplicateLead(workspaceId, input.email ?? null, input.phone ?? null);

  const { assignedToId, autoSelfAssigned } = await resolveCreateAssignedToId(
    workspaceId,
    actor,
    input.assignedToId,
  );
  const followUpOwnerId = assignedToId || actor.id;
  const shouldAutoAssignStage = !input.skipAutoStageAssignment || Boolean(input.stageId);
  const stage = shouldAutoAssignStage
    ? (await resolveStage(workspaceId, input.stageId)) ||
      (await getNewStageForWorkspace(workspaceId)) ||
      (await getDefaultStageForWorkspace(workspaceId)) ||
      null
    : null;
  const lifecycle = await resolveLifecycle(workspaceId, input.lifecycleId);
  const source = await resolveSource(workspaceId, input.sourceId);
  ensureLOBPayload(stage, input.reasonId, input.remarks ?? null);
  await ensureValidLOBReasonForStage(workspaceId, stage, input.reasonId);
  const slaSnapshot = isLobStage(stage) || isClosedWonStage(stage)
    ? emptySlaSnapshot()
    : await buildLeadSlaSnapshot(lifecycle, stage?.id || null);

  const createdLeadId = await prisma.$transaction(async (tx: any) => {
    const outcomeFlags = stage
      ? buildLeadOutcomeFlagsFromStage(stage, actor.id)
      : buildClosureUpdateData(stage, actor.id);

    const lead = await (tx as any).lead.create({
      data: {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        companyName: input.companyName?.trim() || null,
        address: input.address?.trim() || null,
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
        isClosed: outcomeFlags.isClosed,
        isLOB: outcomeFlags.isLOB,
        closedAt: outcomeFlags.closedAt,
        closedById: outcomeFlags.closedById,
        closureType: outcomeFlags.closureType,
        generatedRevenue: outcomeFlags.generatedRevenue,
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
        followUpOwnerId,
        input.nextFollowUpAt,
        input.followUpDescription,
        normalizeFollowUpType(input.nextFollowUpType),
      );
    }

    if (stage?.isLOB) {
      await (tx as any).leadLOBLog.create({
        data: {
          leadId: lead.id,
          reasonId: input.reasonId!,
          remarks: input.remarks?.trim() || null,
          previousStageId: null,
          previousStageName: null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    if (stage) {
      await (tx as any).leadStageHistory.create({
        data: {
          leadId: lead.id,
          fromStageId: null,
          fromStageName: null,
          toStageId: stage.id,
          toStageName: stage.name?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    return lead.id;
  });

  await clearLeadCache(workspaceId);
  if (input.nextFollowUpAt) {
    await touchFollowUpTodayCachesAfterLeadMutation(workspaceId, followUpOwnerId, input.nextFollowUpAt);
  }
  const created = await getLeadScoped(workspaceId, createdLeadId, actor);
  return { lead: mapLeadRecord(created), autoSelfAssigned };
};

export const getLeads = async (
  workspaceId: string,
  query: ListLeadsQueryInput,
  actor?: Actor,
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

  const cacheKey = buildLeadCacheKey(workspaceId, query, actor);
  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const skip = (query.page - 1) * query.limit;
  const where = await buildListWhere(workspaceId, query, actor);

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

  await logLeadVisibilityDebug({
    workspaceId,
    actor,
    query,
    filteredTotal: total,
    responseCount: rows.length,
  });

  if (redisClient.isOpen) {
    await redisClient.setEx(cacheKey, LEADS_CACHE_TTL_SECONDS, JSON.stringify(result));
  }

  return result;
};

export const getLeadById = async (
  workspaceId: string,
  id: string,
  actor?: Actor,
): Promise<ReturnType<typeof mapLeadRecord>> => {
  await assertModuleReady();
  await maybeRunLeadSlaSweep(workspaceId);
  const lead = await getLeadScoped(workspaceId, id, actor);
  return mapLeadRecord(lead);
};

export const updateLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateLeadInput,
): Promise<ReturnType<typeof mapLeadRecord> & { _approvalRequired?: boolean; _approval?: any }> => {
  await assertModuleReady();

  const existing = await getLeadScoped(workspaceId, id, actor);
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

  const normalizeEmailForCompare = (e?: string | null) => e?.trim().toLowerCase() || null;
  const normalizePhoneForCompare = (p?: string | null) => p?.trim() || null;

  const emailChanged = input.email !== undefined &&
    normalizeEmailForCompare(input.email) !== normalizeEmailForCompare(existing.email);
  const phoneChanged = input.phone !== undefined &&
    normalizePhoneForCompare(input.phone) !== normalizePhoneForCompare(existing.phone);

  if (emailChanged || phoneChanged) {
    const checkEmail = emailChanged ? (input.email?.trim() || null) : null;
    const checkPhone = phoneChanged ? (input.phone?.trim() || null) : null;
    await findDuplicateLead(workspaceId, checkEmail, checkPhone, id);
  }

  let assignedToId = existing.assignedToId;
  if (input.assignedToId !== undefined) {
    await ensureAssignmentUpdateAllowed(actor, existing.assignedToId, input.assignedToId);
    assignedToId = await resolveAssignedUserId(workspaceId, input.assignedToId);
  }
  const stage = input.stageId !== undefined ? await resolveStage(workspaceId, input.stageId) : existing.stage;
  const lifecycle = input.lifecycleId !== undefined ? await resolveLifecycle(workspaceId, input.lifecycleId) : existing.lifecycle;
  const source = input.sourceId !== undefined ? await resolveSource(workspaceId, input.sourceId) : existing.source;
  const lifecycleForSla =
    input.lifecycleId !== undefined
      ? lifecycle
      : input.stageId !== undefined && existing.lifecycleId
        ? await resolveLifecycle(workspaceId, existing.lifecycleId)
        : null;

  let approvalResult: any = null;
  if (
    input.stageId !== undefined &&
    stage?.id &&
    existing.stageId &&
    stage.id !== existing.stageId &&
    shouldRequireApprovalForStage(stage)
  ) {
    const requestingUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { supervisorId: true },
    });

    if (!requestingUser?.supervisorId && isManagerialRole(actor.role?.name)) {
      logger.info('Bypassing lead stage approval in updateLead for managerial user without supervisor', {
        userId: actor.id,
        role: actor.role?.name,
        targetStage: stage.name,
      });
    } else {
      const executionRules = await getActiveStageRulesForExecution(workspaceId, stage.id);
      const ruleNameById = new Map(executionRules.map((rule) => [rule.id, rule.name]));
      
      approvalResult = await leadApprovalService.createLeadApproval(
        workspaceId,
        { id: actor.id, roleId: actor.roleId ?? null, role: actor.role },
        {
          leadId: id,
          fromStageId: existing.stageId,
          toStageId: stage.id,
          requestData: {
            reasonId: input.reasonId ?? null,
            remarks: input.remarks ?? null,
            nextFollowUpAt: input.nextFollowUpAt ? input.nextFollowUpAt.toISOString() : null,
            nextFollowUpType: input.nextFollowUpType ?? null,
            followUpDescription: input.followUpDescription ?? null,
            stageRuleValues: [],
            ...(stage.isLOB && existing.stageId
              ? {
                  previousStageId: existing.stageId,
                  previousStageName: existing.stage?.name ?? null,
                }
              : {}),
          },
        },
      );
      
      input.stageId = undefined;
    }
  }

  if (
    input.stageId !== undefined &&
    stage?.id &&
    existing.stageId &&
    stage.id !== existing.stageId
  ) {
    const validationData = await toValidationLeadData(existing, input);
    await validateLeadStageTransition(workspaceId, stage.id, validationData, undefined);
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
    ? (isLobStage(stage) || isClosedWonStage(stage)
        ? emptySlaSnapshot()
        : await buildLeadSlaSnapshot(nextLifecycleForSla, nextStageId))
    : {
        stageEnteredAt: existing.stageEnteredAt,
        stageExpiresAt: existing.stageExpiresAt,
        slaAction: existing.slaAction,
        slaWarningDays: existing.slaWarningDays,
      };

  const updatedLeadId = await prisma.$transaction(async (tx: any) => {
    await (tx as any).lead.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.email !== undefined ? { email } : {}),
        ...(input.phone !== undefined ? { phone } : {}),
        ...(input.companyName !== undefined
          ? { companyName: input.companyName === null ? null : input.companyName.trim() }
          : {}),
        ...(input.address !== undefined ? { address: input.address === null ? null : input.address.trim() } : {}),
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
        ...(stage
          ? (() => {
              const outcomeFlags = buildLeadOutcomeFlagsFromStage(stage, actor.id, {
                isClosed: closureData.isClosed,
                closedAt: closureData.closedAt,
                closedById: closureData.closedById,
                closureType: closureData.closureType,
                generatedRevenue: closureData.generatedRevenue,
              });
              return {
                isLOB: outcomeFlags.isLOB,
                isClosed: outcomeFlags.isClosed,
                closedAt: outcomeFlags.closedAt,
                closedById: outcomeFlags.closedById,
                closureType: outcomeFlags.closureType,
                generatedRevenue: outcomeFlags.generatedRevenue,
              };
            })()
          : { isLOB: false }),
      },
    });

    const followUpOwnerId = assignedToId || existing.createdById;

    if (input.assignedToId !== undefined && existing.assignedToId !== assignedToId) {
      await (tx as any).followUp.updateMany({
        where: {
          leadId: id,
          workspaceId,
          status: 'PENDING',
        },
        data: {
          userId: followUpOwnerId,
        },
      });
    }

    const shouldCreateNewAutoFollowUp =
      Boolean(input.nextFollowUpAt) &&
      (!existing.nextFollowUpAt || existing.nextFollowUpAt.getTime() !== input.nextFollowUpAt!.getTime());

    if (shouldCreateNewAutoFollowUp) {
      await createAutomaticFollowUp(
        tx,
        id,
        workspaceId,
        followUpOwnerId,
        input.nextFollowUpAt!,
        input.followUpDescription,
        normalizeFollowUpType(input.nextFollowUpType),
      );
    } else if (
      nextFollowUpAt &&
      (input.nextFollowUpType !== undefined || input.followUpDescription !== undefined)
    ) {
      const pending = await (tx as any).followUp.findFirst({
        where: {
          leadId: id,
          workspaceId,
          status: 'PENDING',
          scheduledAt: nextFollowUpAt,
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (pending) {
        await (tx as any).followUp.update({
          where: { id: pending.id },
          data: {
            ...(input.nextFollowUpType !== undefined ? { type: normalizeFollowUpType(input.nextFollowUpType) } : {}),
            ...(input.followUpDescription !== undefined
              ? {
                  description:
                    input.followUpDescription?.trim() || 'Auto-created from lead workflow',
                }
              : {}),
          },
        });
      }
    }

    if (stage?.isLOB && (existing.stageId !== stage.id || !existing.isLOB)) {
      await (tx as any).leadLOBLog.create({
        data: {
          leadId: id,
          reasonId: reasonId!,
          remarks: remarks?.trim() || null,
          previousStageId: existing.stageId,
          previousStageName: existing.stage?.name?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    if (stage && existing.stageId !== stage.id) {
      await (tx as any).leadStageHistory.create({
        data: {
          leadId: id,
          fromStageId: existing.stageId,
          fromStageName: existing.stage?.name?.trim() || null,
          toStageId: stage.id,
          toStageName: stage.name?.trim() || null,
          changedById: actor.id,
          workspaceId,
        },
      });
    }

    return id;
  });

  await clearLeadCache(workspaceId);
  if (
    nextFollowUpAt &&
    (input.nextFollowUpAt !== undefined || input.nextFollowUpType !== undefined || input.followUpDescription !== undefined)
  ) {
    await touchFollowUpTodayCachesAfterLeadMutation(workspaceId, assignedToId || existing.createdById, nextFollowUpAt);
  }
  const updated = await getLeadScoped(workspaceId, updatedLeadId, actor);
  const result = mapLeadRecord(updated);
  if (approvalResult) {
    (result as any)._approvalRequired = true;
    (result as any)._approval = approvalResult.approval;
  }
  return result;
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

  const existing = await getLeadScoped(workspaceId, id, actor);
  const targetStage = await resolveStage(workspaceId, input.stageId);

  if (!targetStage) {
    throw createServiceError('Lead stage was not found.', 404);
  }

  if (existing.stageId && existing.stageId !== targetStage.id) {
    const validationData = await toValidationLeadData(existing, input);
    const stageRuleAnswers = stageRuleValuesToAnswerMap(input.stageRuleValues);
    await validateLeadStageTransition(workspaceId, targetStage.id, validationData, stageRuleAnswers);
  }

  ensureLOBPayload(targetStage, input.reasonId, input.remarks ?? null);
  await ensureValidLOBReasonForStage(workspaceId, targetStage, input.reasonId);

  if (existing.stageId !== targetStage.id && shouldRequireApprovalForStage(targetStage)) {
    const requestingUser = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { supervisorId: true },
    });

    if (!requestingUser?.supervisorId && isManagerialRole(actor.role?.name)) {
      logger.info('Bypassing lead stage approval for managerial user without supervisor', {
        userId: actor.id,
        role: actor.role?.name,
        targetStage: targetStage.name,
      });
    } else {
      const executionRules = await getActiveStageRulesForExecution(workspaceId, targetStage.id);
      const ruleNameById = new Map(executionRules.map((rule) => [rule.id, rule.name]));
      const stageRuleValuesForRequest = (input.stageRuleValues ?? []).map((entry) => ({
        ruleId: entry.ruleId,
        value: entry.value,
        ruleName: ruleNameById.get(entry.ruleId) || entry.ruleId,
      }));

      const result = await leadApprovalService.createLeadApproval(
        workspaceId,
        { id: actor.id, roleId: actor.roleId ?? null, role: actor.role },
        {
          leadId: id,
          fromStageId: existing.stageId!,
          toStageId: targetStage.id,
          requestData: {
            reasonId: input.reasonId ?? null,
            remarks: input.remarks ?? null,
            nextFollowUpAt: input.nextFollowUpAt ? input.nextFollowUpAt.toISOString() : null,
            nextFollowUpType: input.nextFollowUpType ?? null,
            followUpDescription: input.followUpDescription ?? null,
            stageRuleValues: stageRuleValuesForRequest,
            ...(targetStage.isLOB && existing.stageId
              ? {
                  previousStageId: existing.stageId,
                  previousStageName: existing.stage?.name ?? null,
                }
              : {}),
          },
        },
      );

      return {
        approvalRequired: true,
        lead: result.lead,
        approval: result.approval,
      };
    }
  }

  const updatedLead = await updateLead(workspaceId, actor, id, {
    stageId: input.stageId,
    reasonId: input.reasonId,
    remarks: input.remarks,
    nextFollowUpAt: input.nextFollowUpAt,
    nextFollowUpType: input.nextFollowUpType,
    followUpDescription: input.followUpDescription,
  });

  if (existing.stageId && existing.stageId !== targetStage.id) {
    await persistLeadStageRuleValues(id, input.stageRuleValues);
  }

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

  await prisma.$transaction(async (tx: any) => {
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
    await prisma.$transaction(async (tx: any) => {
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

const buildLeadExportCsvRow = (lead: LeadIncludeRecord): unknown[] => [
  lead.id,
  lead.name,
  lead.email || '',
  lead.phone || '',
  lead.companyName || '',
  lead.address || '',
  lead.expectedRevenue ?? '',
  lead.assignedTo ? resolveDisplayName(lead.assignedTo) : '',
  lead.stage?.name || '',
  lead.lifecycle?.name || '',
  lead.source?.name || '',
  lead.nextFollowUpAt ? lead.nextFollowUpAt.toISOString() : '',
  lead.isClosed ? 'Yes' : 'No',
  lead.isLOB ? 'Yes' : 'No',
  lead.deletedAt ? lead.deletedAt.toISOString() : '',
  resolveDisplayName(lead.createdBy),
  lead.createdAt.toISOString(),
  lead.updatedAt.toISOString(),
];

export const exportLeads = async (
  workspaceId: string,
  query: ExportLeadsQueryInput,
  actor?: Actor,
): Promise<{ filename: string; content: string; contentType: string }> => {
  await assertModuleReady();

  const where = await buildListWhere(workspaceId, query, actor, { includeArchived: query.includeArchived });

  const headers = [
    'Lead ID',
    'Name',
    'Email',
    'Phone',
    'Company Name',
    'Address',
    'Expected Revenue',
    'Assigned To',
    'Stage',
    'Lifecycle',
    'Source',
    'Next Follow Up At',
    'Is Closed',
    'Is LOB',
    'Archived At',
    'Created By',
    'Created At',
    'Updated At',
  ];

  // Cursor batching: stable order by id so exports scale without loading the full table into memory.
  const EXPORT_BATCH = 750;
  const lines: unknown[][] = [];
  let cursorId: string | undefined;

  for (;;) {
    const batch = (await (prisma as any).lead.findMany({
      where,
      take: EXPORT_BATCH,
      orderBy: { id: 'asc' },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: leadInclude,
    })) as LeadIncludeRecord[];

    if (!batch.length) {
      break;
    }

    for (const lead of batch) {
      lines.push(buildLeadExportCsvRow(lead));
    }

    if (batch.length < EXPORT_BATCH) {
      break;
    }

    cursorId = batch[batch.length - 1]!.id;
  }

  const content = [headers, ...lines].map((row) => row.map(escapeCsv).join(',')).join('\n');
  return {
    filename: `leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
    content,
    contentType: 'text/csv; charset=utf-8',
  };
};

export const canAssignOtherUsers = async (actor: Actor): Promise<boolean> =>
  actorCanAssignToOthers(actor);


