import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
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
  role?: { name?: string | null } | null;
};

type LeadIncludeRecord = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  expectedRevenue: number | null;
  assignedToId: string | null;
  stageId: string | null;
  lifecycleId: string | null;
  sourceId: string | null;
  nextFollowUpAt: Date | null;
  isClosed: boolean;
  isLOB: boolean;
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
  deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
  createdAt: lead.createdAt.toISOString(),
  updatedAt: lead.updatedAt.toISOString(),
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

const clearLeadCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isOpen) return;

  const keysToDelete: string[] = [];

  for await (const key of (redisClient as any).scanIterator({ MATCH: `leads:${workspaceId}:*`, COUNT: 100 })) {
    if (typeof key === 'string' && key.length > 0) {
      keysToDelete.push(key);
    }
  }

  if (keysToDelete.length > 0) {
    await redisClient.del(keysToDelete);
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
    },
  });

  if (!lifecycle) {
    throw createServiceError('Lead lifecycle was not found in this workspace.', 404);
  }

  return lifecycle;
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

  if (!remarks || !remarks.trim()) {
    throw createServiceError('remarks are required when moving a lead to LOB.', 422);
  }
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
    deletedAt: null,
  };

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
  const stage = await resolveStage(input.stageId);
  const lifecycle = await resolveLifecycle(workspaceId, input.lifecycleId);
  const source = await resolveSource(input.sourceId);
  ensureLOBPayload(stage, input.reasonId, input.remarks ?? null);

  const createdLeadId = await prisma.$transaction(async (tx) => {
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
        isClosed: Boolean(stage?.isClosed || stage?.isLOB),
        isLOB: Boolean(stage?.isLOB),
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

  const remarks = input.remarks === null ? null : input.remarks ?? null;
  const reasonId = input.reasonId === null ? null : input.reasonId ?? null;
  ensureLOBPayload(stage, reasonId, remarks);

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
        ...(input.isClosed !== undefined ? { isClosed: input.isClosed } : {}),
        isLOB: Boolean(stage?.isLOB),
        ...(stage ? { isClosed: input.isClosed ?? Boolean(stage.isClosed || stage.isLOB) } : {}),
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
): Promise<ReturnType<typeof mapLeadRecord>> =>
  updateLead(workspaceId, actor, id, {
    stageId: input.stageId,
    reasonId: input.reasonId,
    remarks: input.remarks,
    nextFollowUpAt: input.nextFollowUpAt,
    followUpDescription: input.followUpDescription,
  });

export const assignLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: AssignLeadInput,
): Promise<ReturnType<typeof mapLeadRecord>> =>
  updateLead(workspaceId, actor, id, {
    assignedToId: input.assignedToId,
  });

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
