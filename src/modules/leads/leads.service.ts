import { LeadClosureType } from '../../../prisma/generated/client';
import type { ClosedLeadQueryInput, UpdateClosedLeadInput } from './leads.validation';
import * as leadsRepository from './leads.repository';

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

const mapClosedLead = (lead: any) => ({
  ...lead,
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
  if (!actor.roleId) return [];
  if (normalizeRoleKey(actor.role?.name) === 'superadmin') return ['*'];
  return leadsRepository.getRolePermissionKeys(actor.roleId);
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

const buildAccessWhere = async (workspaceId: string, actor: Actor): Promise<any> => {
  const permissions = await getPermissionKeys(actor);

  if (permissions.includes('*') || permissions.includes('LEADS_VIEW_ALL')) {
    return {};
  }

  if (permissions.includes('LEADS_VIEW_TEAM')) {
    const teamUserIds = await leadsRepository.getTeamUserIds(workspaceId, actor.id);
    const scopedIds = Array.from(new Set([actor.id, ...teamUserIds]));

    return {
      OR: [
        { assignedToId: { in: scopedIds } },
        { createdById: { in: scopedIds } },
      ],
    };
  }

  if (permissions.includes('LEADS_VIEW_OWN')) {
    return {
      OR: [
        { assignedToId: actor.id },
        { createdById: actor.id },
      ],
    };
  }

  throw createServiceError('Access denied. You need lead view permissions to access closed leads.', 403);
};

const buildClosedWhere = async (workspaceId: string, actor: Actor, query: ClosedLeadQueryInput) => {
  const accessWhere = await buildAccessWhere(workspaceId, actor);

  const where: any = {
    workspaceId,
    deletedAt: null,
    isClosed: true,
    ...accessWhere,
  };

  if (query.search) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search, mode: 'insensitive' } },
        ],
      },
    ];
  }

  if (query.assignedTo) where.assignedToId = query.assignedTo;
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

  if (!lead.isClosed) {
    throw createServiceError('Lead is not closed. Move it to the closure stage first.', 409);
  }

  const updated = await leadsRepository.updateLeadClosure(id, {
    isClosed: true,
    closedAt: lead.closedAt || new Date(),
    closedById: lead.closedById || actor.id,
    generatedRevenue: input.generatedRevenue,
    closureType: input.closureType,
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
    closedAt: null,
    closedById: null,
    generatedRevenue: 0,
    closureType: null,
  });

  return mapClosedLead(reopened);
};

export const exportClosedLeads = async (workspaceId: string, actor: Actor, query: ClosedLeadQueryInput) => {
  await ensureModuleReady();

  const where = await buildClosedWhere(workspaceId, actor, query);
  const rows = await leadsRepository.exportClosedLeads(where);

  const headers = [
    'Lead ID',
    'Name',
    'Email',
    'Phone',
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
    lead.phone || '',
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

export const isClosureStage = (stage?: { isClosed?: boolean | null; name?: string | null } | null): boolean =>
  Boolean(stage?.isClosed || normalizeRoleKey(stage?.name) === 'closure');

export const buildClosureUpdateData = (
  stage: { isClosed?: boolean | null; name?: string | null } | null,
  actorId: string,
  existing?: {
    isClosed?: boolean;
    closedAt?: Date | null;
    closedById?: string | null;
    generatedRevenue?: number | null;
    closureType?: LeadClosureType | null;
  },
) => {
  const shouldClose = isClosureStage(stage);

  if (!shouldClose) {
    if (existing?.isClosed) {
      throw createServiceError('Use the reopen endpoint to move a closed lead back into the active pipeline.', 409);
    }

    return {
      isClosed: false,
      closedAt: null,
      closedById: null,
      closureType: null as LeadClosureType | null,
      generatedRevenue: existing?.generatedRevenue ?? 0,
    };
  }

  return {
    isClosed: true,
    closedAt: existing?.closedAt || new Date(),
    closedById: existing?.closedById || actorId,
    closureType: existing?.closureType || null,
    generatedRevenue: existing?.generatedRevenue ?? 0,
  };
};
