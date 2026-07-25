import { LeadClosureType } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { ClosedLeadQueryInput, UpdateClosedLeadInput } from './leads.validation';
import * as leadsRepository from './leads.repository';
import prisma from '../../config/prisma';
import { formatPhoneStr } from '../../utils/phoneUtils';
import {
  buildLeadOutcomeFlagsFromStage,
  closedModuleLeadWhere,
  isClosedWonStage,
  isLobStage,
} from './leadVisibility.util';

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

/** DB role names that bypass permission resolution (full access). */
const isPrivilegedRoleName = (role?: string | null): boolean => {
  const normalized = normalizeRoleKey(role);
  return (
    normalized === 'superadmin' ||
    normalized === 'admin' ||
    normalized === 'administrator' ||
    normalized === 'workspaceadmin' ||
    normalized.endsWith('admin')
  );
};

export type LeadVisibilityMode = 'all' | 'team' | 'own' | 'none';

/**
 * Resolves effective lead visibility from permission keys alone.
 * If multiple `LEADS_VIEW_*` keys are attached to a role, the broadest scope wins so
 * misconfigured roles do not accidentally hide existing leads.
 */
export const resolveLeadScopeFromPermissionKeys = (permissions: string[]): LeadVisibilityMode => {
  if (permissions.includes('*')) return 'all';
  if (
    permissions.includes('LEADS_VIEW_ALL') ||
    permissions.includes('DASHBOARD_VIEW_ALL') ||
    permissions.includes('DASHBOARD_VIEW_ALL_OFFICES')
  ) return 'all';
  if (
    permissions.includes('LEADS_VIEW_TEAM') ||
    permissions.includes('DASHBOARD_VIEW_ASSIGNED') ||
    permissions.includes('DASHBOARD_VIEW_ASSIGNED_OFFICES')
  ) return 'team';
  if (
    permissions.includes('LEADS_VIEW_OWN') ||
    permissions.includes('DASHBOARD_VIEW_OWN') ||
    permissions.includes('DASHBOARD_VIEW_OWN_OFFICE')
  ) return 'own';
  return 'none';
};

/** Same visibility semantics as `buildAccessWhere`, without building lead Prisma filters. */
export const resolveLeadVisibilityMode = async (workspaceId: string, actor: Actor): Promise<LeadVisibilityMode> => {
  const permissions = await getPermissionKeys(actor);
  return resolveLeadScopeFromPermissionKeys(permissions);
};

export const resolveVisibleLeadUserScope = async (
  workspaceId: string,
  actor: Actor,
): Promise<string[] | 'ALL'> => {
  const mode = await resolveLeadVisibilityMode(workspaceId, actor);

  if (mode === 'all') return 'ALL';
  if (mode === 'none') return [];
  if (mode === 'own') return [actor.id];

  const teamUserIds = await leadsRepository.getTeamUserIds(workspaceId, actor.id);
  return Array.from(new Set([actor.id, ...teamUserIds]));
};

/**
 * Assignee dropdown scope for Bulk Reschedule (Follow-up Settings).
 * Super Admin / Admin → all workspace users; Supervisor → self + reporting tree; others → self only.
 */
const resolveActorRoleName = async (actor: Actor): Promise<string | null> => {
  if (actor.role?.name?.trim()) {
    return actor.role.name.trim();
  }
  if (!actor.roleId) {
    return null;
  }
  const role = await prisma.role.findFirst({
    where: { id: actor.roleId },
    select: { name: true },
  });
  return role?.name?.trim() || null;
};

export const resolveBulkRescheduleAssigneeScope = async (
  workspaceId: string,
  actor: Actor,
): Promise<string[] | 'ALL'> => {
  const ownedWorkspace = await prisma.workspace.findFirst({
    where: { ownerId: actor.id },
    select: { id: true },
  });
  if (ownedWorkspace?.id === workspaceId) {
    return 'ALL';
  }

  if (await isWorkspaceOwner(workspaceId, actor.id)) {
    return 'ALL';
  }

  const roleName = await resolveActorRoleName(actor);
  if (isPrivilegedRoleName(roleName)) {
    return 'ALL';
  }
  if (normalizeRoleKey(roleName) === 'superadmin') {
    return 'ALL';
  }

  const permissions = await getPermissionKeys({ ...actor, role: { name: roleName } });
  if (
    permissions.includes('*') ||
    permissions.includes('SUPERADMIN') ||
    permissions.includes('LEADS_VIEW_ALL') ||
    permissions.includes('manage_followup_settings') ||
    permissions.includes('bulk_extend_followups') ||
    permissions.includes('grant_bulk_extension_access') ||
    permissions.includes('view_followup_capacity') ||
    permissions.includes('USERS_VIEW') ||
    permissions.includes('SYSTEM_CONFIG')
  ) {
    return 'ALL';
  }

  const roleKey = normalizeRoleKey(roleName);
  if (roleKey === 'supervisor' || roleKey === 'teamleader') {
    const teamUserIds = await leadsRepository.getRecursiveTeamUserIds(workspaceId, actor.id);
    return Array.from(new Set([actor.id, ...teamUserIds]));
  }

  const directReports = await leadsRepository.getTeamUserIds(workspaceId, actor.id);
  if (directReports.length > 0) {
    const teamUserIds = await leadsRepository.getRecursiveTeamUserIds(workspaceId, actor.id);
    return Array.from(new Set([actor.id, ...teamUserIds]));
  }

  return [actor.id];
};

/**
 * Users an actor may view or bulk-manage follow-ups for (role hierarchy + follow-up admin permissions).
 * Used by follow-up assignee pickers and history filters — broader than LEADS_VIEW_OWN when admin/supervisor.
 */
export const resolveManageableFollowUpUserScope = async (
  workspaceId: string,
  actor: Actor,
): Promise<string[] | 'ALL'> => {
  if (await isWorkspaceOwner(workspaceId, actor.id)) {
    return 'ALL';
  }

  const permissions = await getPermissionKeys(actor);

  if (
    permissions.includes('*') ||
    permissions.includes('SUPERADMIN') ||
    permissions.includes('LEADS_VIEW_ALL')
  ) {
    return 'ALL';
  }

  if (
    permissions.includes('manage_followup_settings') ||
    permissions.includes('bulk_extend_followups') ||
    permissions.includes('grant_bulk_extension_access') ||
    permissions.includes('view_followup_capacity') ||
    permissions.includes('USERS_VIEW') ||
    permissions.includes('SYSTEM_CONFIG')
  ) {
    return 'ALL';
  }

  if (isPrivilegedRoleName(actor.role?.name)) {
    return 'ALL';
  }

  const roleKey = normalizeRoleKey(actor.role?.name);
  if (
    roleKey === 'manager' ||
    roleKey === 'supervisor' ||
    roleKey === 'teamleader' ||
    permissions.includes('LEADS_VIEW_TEAM')
  ) {
    const teamUserIds = await leadsRepository.getRecursiveTeamUserIds(workspaceId, actor.id);
    return Array.from(new Set([actor.id, ...teamUserIds]));
  }

  const directReports = await leadsRepository.getTeamUserIds(workspaceId, actor.id);
  if (directReports.length > 0) {
    const teamUserIds = await leadsRepository.getRecursiveTeamUserIds(workspaceId, actor.id);
    return Array.from(new Set([actor.id, ...teamUserIds]));
  }

  if (permissions.includes('LEADS_VIEW_OWN')) {
    return [actor.id];
  }

  return [actor.id];
};

/** Restricts workspace user counts (e.g. Active Users KPI) to the same cohort as lead visibility. */
export const buildActiveUsersScopedWhere = async (
  workspaceId: string,
  actor: Actor,
): Promise<Prisma.UserWhereInput> => {
  const visibleUserScope = await resolveVisibleLeadUserScope(workspaceId, actor);
  if (visibleUserScope === 'ALL') return {};
  if (visibleUserScope.length === 0) return { id: { in: [] } };
  return { id: { in: visibleUserScope } };
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string | null => {
  if (!user) return null;
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return user.username.trim();
  return user.email || null;
};

const mapClosedLead = (lead: any) => ({
  ...lead,
  revenueApprovedAt: lead.revenueApprovedAt ? lead.revenueApprovedAt.toISOString() : null,
  closedAt: lead.closedAt ? lead.closedAt.toISOString() : null,
  deletedAt: lead.deletedAt ? lead.deletedAt.toISOString() : null,
  createdAt: lead.createdAt.toISOString(),
  updatedAt: lead.updatedAt.toISOString(),
  assignedTo: lead.assignedTo
    ? {
        ...lead.assignedTo,
        displayName: resolveDisplayName(lead.assignedTo),
      }
    : null,
  createdBy: lead.createdBy
    ? {
        ...lead.createdBy,
        displayName: resolveDisplayName(lead.createdBy),
      }
    : null,
  closedBy: lead.closedBy
    ? {
        ...lead.closedBy,
        displayName: resolveDisplayName(lead.closedBy),
      }
    : null,
});

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await leadsRepository.ensureClosedLeadSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Closed leads module is not ready. Required closure columns are missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const getPermissionKeys = async (actor: Actor): Promise<string[]> => {
  if (isPrivilegedRoleName(actor.role?.name)) return ['*'];
  if (!actor.roleId) return [];
  const keys = await leadsRepository.getRolePermissionKeys(actor.roleId);
  if (keys.includes('SUPERADMIN')) return ['*'];
  return keys;
};

const isWorkspaceOwner = async (workspaceId: string, userId: string): Promise<boolean> => {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, ownerId: userId },
    select: { id: true },
  });
  return Boolean(workspace);
};

const assertEditPermission = async (actor: Actor): Promise<void> => {
  const permissions = await getPermissionKeys(actor);
  if (permissions.includes('*') || permissions.includes('LEADS_EDIT')) return;
  throw createServiceError('Access denied. You need the LEADS_EDIT permission.', 403);
};

const assertReopenPermission = async (actor: Actor): Promise<void> => {
  const normalizedRole = normalizeRoleKey(actor.role?.name);
  if (['admin', 'manager', 'superadmin'].includes(normalizedRole)) return;

  const permissions = await getPermissionKeys(actor);
  if (permissions.includes('*') || permissions.includes('LEADS_REOPEN')) return;

  throw createServiceError('Access denied. Only admins or managers can reopen closed leads.', 403);
};

/** Exported for dashboard / analytics so KPIs match the same lead visibility as list APIs. */
export const buildAccessWhere = async (workspaceId: string, actor: Actor): Promise<any> => {
  const visibleUserScope = await resolveVisibleLeadUserScope(workspaceId, actor);

  if (visibleUserScope === 'ALL') {
    return {};
  }

  if (visibleUserScope.length > 0) {
    return {
      OR: [
        { assignedToId: { in: visibleUserScope } },
        { createdById: { in: visibleUserScope } },
      ],
    };
  }

  throw createServiceError('Access denied. You need lead view permissions to access leads.', 403);
};

const buildClosedWhere = async (workspaceId: string, actor: Actor, query: ClosedLeadQueryInput) => {
  const accessWhere = await buildAccessWhere(workspaceId, actor);
  const andConditions: any[] = [closedModuleLeadWhere()];

  if (Object.keys(accessWhere).length > 0) {
    andConditions.push(accessWhere);
  }

  const where: any = {
    workspaceId,
    deletedAt: null,
    AND: andConditions,
  };

  if (query.search) {
    where.AND = [
      ...where.AND,
      {
        OR: [
          { name: { contains: query.search, mode: 'insensitive'} },
          { email: { contains: query.search, mode: 'insensitive'} },
          { phone: { contains: query.search, mode: 'insensitive'} },
          { companyName: { contains: query.search, mode: 'insensitive'} },
          { assignedTo: { name: { contains: query.search, mode: 'insensitive'} } },
          { source: { name: { contains: query.search, mode: 'insensitive'} } },
          { stage: { name: { contains: query.search, mode: 'insensitive'} } },
        ],
      },
    ];
  }

  if (query.assignedTo) where.assignedToId = query.assignedTo;
  if (query.officeId) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      { assignedTo: { officeId: query.officeId } },
    ];
  }
  if (query.source) where.sourceId = query.source;
  if (query.closureType) where.closureType = query.closureType;
  if (query.minRevenue !== undefined || query.maxRevenue !== undefined) {
    where.generatedRevenue = {
      ...(query.minRevenue !== undefined ? { gte: query.minRevenue } : {}),
      ...(query.maxRevenue !== undefined ? { lte: query.maxRevenue } : {}),
    };
  }
  if (query.dateFrom || query.dateTo) {
    where.closedAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }

  return where;
};

export const listClosedLeads = async (workspaceId: string, actor: Actor, query: ClosedLeadQueryInput) => {
  await ensureModuleReady();
  await leadsRepository.reconcileClosedLeadFlags(workspaceId);

  const where = await buildClosedWhere(workspaceId, actor, query);
  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await leadsRepository.listClosedLeads(where, skip, query.limit);

  return {
    data: rows.map(mapClosedLead),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const updateClosedLead = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateClosedLeadInput,
) => {
  await ensureModuleReady();
  await assertEditPermission(actor);

  const lead = await leadsRepository.findLeadById(workspaceId, id);
  if (!lead || lead.deletedAt) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  const isEffectivelyClosedWon = Boolean(
    !lead.isLOB && !lead.stage?.isLOB && (lead.isClosed || isClosedWonStage(lead.stage)),
  );
  if (!isEffectivelyClosedWon) {
    throw createServiceError('Lead is not in a closed won stage. LOB leads belong in LOB Analysis only.', 409);
  }

  const now = new Date();
  const closingUserId = lead.assignedToId || actor.id;
  const stageId = lead.stageId;

  if (input.closureType === 'WON' && input.generatedRevenue > 0 && !stageId) {
    throw createServiceError('Lead must have a closed stage assigned before saving won revenue.', 422);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const leadUpdateData: Record<string, unknown> = {
      isClosed: true,
      isLOB: false,
      closedAt: lead.closedAt || now,
      closedById: lead.closedById || actor.id,
      generatedRevenue: input.generatedRevenue,
      totalAmount: input.generatedRevenue,
      closureType: input.closureType,
    };

    if (input.closureType === 'WON' && input.generatedRevenue > 0) {
      leadUpdateData.earnedRevenue = input.generatedRevenue;
      leadUpdateData.revenueApprovedById = actor.id;
      leadUpdateData.revenueApprovedAt = now;
    } else {
      leadUpdateData.earnedRevenue = null;
      leadUpdateData.revenueApprovedById = null;
      leadUpdateData.revenueApprovedAt = null;
    }

    const updatedLead = await (tx as any).lead.update({
      where: { id },
      data: leadUpdateData,
      select: leadsRepository.closedLeadSelect,
    });

    const existingTransaction = await (tx as any).revenueTransaction.findFirst({
      where: { workspaceId, leadId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (input.closureType === 'WON' && input.generatedRevenue > 0 && stageId) {
      if (existingTransaction) {
        await (tx as any).revenueTransaction.update({
          where: { id: existingTransaction.id },
          data: {
            amount: input.generatedRevenue,
            approvedById: actor.id,
            userId: closingUserId,
            closedStageId: stageId,
          },
        });
      } else {
        await (tx as any).revenueTransaction.create({
          data: {
            workspaceId,
            leadId: id,
            userId: closingUserId,
            approvedById: actor.id,
            amount: input.generatedRevenue,
            closedStageId: stageId,
          },
        });
      }
    } else if (existingTransaction) {
      await (tx as any).revenueTransaction.delete({
        where: { id: existingTransaction.id },
      });
    }

    await (tx as any).leadActivity.create({
      data: {
        leadId: id,
        performedById: actor.id,
        workspaceId,
        action: 'LEAD_CLOSURE_REVENUE_UPDATED',
        metadata: {
          generatedRevenue: input.generatedRevenue,
          closureType: input.closureType,
          previousGeneratedRevenue: lead.generatedRevenue ?? 0,
          previousClosureType: lead.closureType,
          stageId,
        },
      },
    });

    return updatedLead;
  });

  return mapClosedLead(updated);
};

export const reopenClosedLead = async (workspaceId: string, actor: Actor, id: string) => {
  await ensureModuleReady();
  await assertReopenPermission(actor);

  const lead = await leadsRepository.findLeadById(workspaceId, id);
  if (!lead || lead.deletedAt) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  if (!lead.isClosed) {
    throw createServiceError('Lead is already open.', 409);
  }

  const reopened = await leadsRepository.updateLeadClosure(id, {
    isClosed: false,
    isLOB: false,
    closedAt: null,
    closedById: null,
    generatedRevenue: 0,
    closureType: null,
  });

  return mapClosedLead(reopened);
};

export const exportClosedLeads = async (workspaceId: string, actor: Actor, query: ClosedLeadQueryInput) => {
  await ensureModuleReady();
  await leadsRepository.reconcileClosedLeadFlags(workspaceId);

  const where = await buildClosedWhere(workspaceId, actor, query);
  const rows = await leadsRepository.exportClosedLeads(where);

  const headers = [
    'Lead ID',
    'Name',
    'Email',
    'Phone',
    'Company Name',
    'Address',
    'Assigned To',
    'Source',
    'Closure Type',
    'Expected Revenue',
    'Generated Revenue',
    'Closed At',
    'Closed By',
    'Created At',
  ];

  const lines = rows.map((lead: any) => [
    lead.id,
    lead.name,
    lead.email || '',
    formatPhoneStr(lead.phone),
    lead.companyName || '',
    lead.address || '',
    resolveDisplayName(lead.assignedTo) || '',
    lead.source?.name || '',
    lead.closureType || '',
    lead.expectedRevenue ?? '',
    lead.generatedRevenue ?? 0,
    lead.closedAt ? lead.closedAt.toISOString() : '',
    resolveDisplayName(lead.closedBy) || '',
    lead.createdAt.toISOString(),
  ]);

  return {
    filename: `closed-leads-${new Date().toISOString().slice(0, 10)}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content: [headers, ...lines].map((row) => row.map(escapeCsv).join(',')).join('\n'),
  };
};

export const isClosureStage = (stage?: { isClosed?: boolean | null; isLOB?: boolean | null; name?: string | null } | null): boolean =>
  isClosedWonStage(stage);

export const buildClosureUpdateData = (
  stage: { isClosed?: boolean | null; isLOB?: boolean | null; name?: string | null } | null,
  actorId: string,
  existing?: {
    isClosed?: boolean;
    closedAt?: Date | null;
    closedById?: string | null;
    generatedRevenue?: number | null;
    closureType?: LeadClosureType | null;
  },
) => {
  if (isLobStage(stage)) {
    return buildLeadOutcomeFlagsFromStage(stage, actorId, existing);
  }

  const shouldClose = isClosureStage(stage);

  if (!shouldClose) {
    if (existing?.isClosed) {
      throw createServiceError('Use the reopen endpoint to move a closed lead back into the active pipeline.', 409);
    }

    return {
      isLOB: false,
      isClosed: false,
      closedAt: null,
      closedById: null,
      closureType: null as LeadClosureType | null,
      generatedRevenue: existing?.generatedRevenue ?? 0,
    };
  }

  return buildLeadOutcomeFlagsFromStage(stage, actorId, existing);
};
