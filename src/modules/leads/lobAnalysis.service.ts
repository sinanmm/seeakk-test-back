import * as repository from './lobAnalysis.repository';
import type { LOBAnalysisAuditQueryInput, LOBAnalysisQueryInput } from './lobAnalysis.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type LocationAwareUser = {
  officeId?: string | null;
  countryId?: string | null;
  stateId?: string | null;
  districtId?: string | null;
  assignedLocations?: Array<{ locationId: string }>;
} | null | undefined;

type NormalizedLOBEvent = {
  id: string;
  leadId: string;
  leadName: string;
  fromStageId: string | null;
  fromStageName: string;
  reasonId: string;
  reasonName: string;
  changedById: string;
  changedByName: string;
  remarks: string | null;
  createdAt: string;
  createdAtDate: Date;
};

const SYSTEM_REASON_LABELS: Record<string, string> = {
  SYSTEM_SLA_EXPIRED: 'System SLA Expired',
  'approval-auto-lob': 'Approval Auto LOB',
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string => {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.username?.trim()) return user.username.trim();
  if (user?.email?.trim()) return user.email.trim();
  return 'Unknown User';
};

const normalizeStageKey = (value?: string | null): string =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const startOfDay = (value: string) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (value: string) => {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
};

const buildChangedAtRange = (filters: LOBAnalysisQueryInput) => {
  if (!filters.date_from && !filters.date_to) return undefined;

  return {
    ...(filters.date_from ? { gte: startOfDay(filters.date_from) } : {}),
    ...(filters.date_to ? { lte: endOfDay(filters.date_to) } : {}),
  };
};

const matchesLocation = (user: LocationAwareUser, locationId?: string) => {
  if (!locationId) return true;
  if (!user) return false;

  return (
    user.officeId === locationId ||
    user.countryId === locationId ||
    user.stateId === locationId ||
    user.districtId === locationId ||
    Boolean(user.assignedLocations?.some((item) => item.locationId === locationId))
  );
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureLOBAnalysisSchemaReady();
  if (!ready) {
    throw createServiceError(
      'LOB analysis module is not ready: database is missing required tables or lead_lob_logs columns (previousStageId, previousStageName). On production run `npm run migrate` (prisma migrate deploy) so migration 20260418183000_lead_lob_log_previous_stage is applied, then redeploy.',
      503,
    );
  }
};

const deriveFromStage = (
  event: {
    leadId: string;
    changedById: string;
    changedAt: Date;
    previousStageId?: string | null;
    previousStageName?: string | null;
  },
  approvalsByLead: Map<string, any[]>,
  auditsByLead: Map<string, any[]>,
  stageIdByNameKey: Map<string, string>,
) => {
  const storedId =
    typeof event.previousStageId === 'string' && event.previousStageId.trim() ? event.previousStageId.trim() : null;
  const storedName =
    typeof event.previousStageName === 'string' && event.previousStageName.trim()
      ? event.previousStageName.trim()
      : null;
  if (storedId || storedName) {
    const resolvedId = storedId || stageIdByNameKey.get(normalizeStageKey(storedName));
    return {
      id: resolvedId || null,
      name: storedName || 'Unknown Stage',
    };
  }

  const approvalCandidates = approvalsByLead.get(event.leadId) || [];
  const approvalMatch = approvalCandidates.find((item) => {
    if (!item.approvedAt) return false;
    const delta = Math.abs(new Date(item.approvedAt).getTime() - event.changedAt.getTime());
    return item.approvedById === event.changedById && delta <= 5 * 60_000;
  });

  if (approvalMatch?.fromStageId) {
    return {
      id: approvalMatch.fromStageId,
      name: approvalMatch.fromStage?.name || 'Unknown Stage',
    };
  }

  const auditTrail = auditsByLead.get(event.leadId) || [];
  const auditMatch = auditTrail.find((item) => {
    if (!item.createdAt || item.createdAt >= event.changedAt) return false;
    if (item.action === 'LEAD_LOB_APPLIED') return false;
    return true;
  });

  if (auditMatch) {
    const details = (auditMatch.details || {}) as Record<string, unknown>;
    const previousStageName =
      (typeof details.previousStageName === 'string' && details.previousStageName.trim()
        ? details.previousStageName
        : null) ||
      (typeof details.fromStageName === 'string' && details.fromStageName.trim() ? details.fromStageName : null) ||
      (typeof details.stageName === 'string' && details.stageName.trim() ? details.stageName : null);
    const previousStageId =
      (typeof details.previousStageId === 'string' && details.previousStageId.trim()
        ? details.previousStageId
        : null) ||
      (typeof details.fromStageId === 'string' && details.fromStageId.trim() ? details.fromStageId : null) ||
      (typeof details.stageId === 'string' && details.stageId.trim() ? details.stageId : null);

    const resolvedId = previousStageId || stageIdByNameKey.get(normalizeStageKey(previousStageName));

    return {
      id: resolvedId || null,
      name: previousStageName || 'Unknown Stage',
    };
  }

  return {
    id: null,
    name: 'Unknown Stage',
  };
};

const normalizeLOBEvents = async (workspaceId: string, filters: LOBAnalysisQueryInput): Promise<NormalizedLOBEvent[]> => {
  const changedAtRange = buildChangedAtRange(filters);
  const rawEvents = await repository.findLOBEvents(workspaceId, changedAtRange);
  const leadIds = Array.from(new Set<string>(rawEvents.map((item: any) => String(item.leadId))));

  const [approvalRows, auditRows, reasonRows, userRows, stageRows] = await Promise.all([
    repository.findLOBApprovalTransitions(workspaceId, leadIds),
    repository.findLeadStageAuditTrail(workspaceId, leadIds),
    repository.findLOBReasonsByIds(
      workspaceId,
      Array.from(
        new Set<string>(
          rawEvents
            .map((item: any) => (typeof item.reasonId === 'string' ? item.reasonId : ''))
            .filter((value: string): value is string => Boolean(value)),
        ),
      ),
    ),
    repository.findUsersByIds(
      workspaceId,
      Array.from(
        new Set<string>(
          rawEvents
            .map((item: any) => item.changedById)
            .filter((value: string) => Boolean(value) && value !== 'system'),
        ),
      ),
    ),
    repository.findWorkspaceStages(workspaceId),
  ]);

  const approvalsByLead = new Map<string, any[]>();
  approvalRows.forEach((item: any) => {
    const bucket = approvalsByLead.get(item.leadId) || [];
    bucket.push(item);
    approvalsByLead.set(item.leadId, bucket);
  });

  const auditsByLead = new Map<string, any[]>();
  auditRows.forEach((item) => {
    const bucket = auditsByLead.get(item.entityId || '') || [];
    bucket.push(item);
    auditsByLead.set(item.entityId || '', bucket);
  });

  const reasonsById = new Map<string, { id: string; name: string }>();
  reasonRows.forEach((item) => {
    reasonsById.set(item.id, { id: item.id, name: item.name });
  });

  const usersById = new Map<string, { id: string; displayName: string }>();
  userRows.forEach((item) => {
    usersById.set(item.id, {
      id: item.id,
      displayName: resolveDisplayName(item),
    });
  });

  const stageIdByNameKey = new Map<string, string>();
  stageRows.forEach((stage) => {
    stageIdByNameKey.set(normalizeStageKey(stage.name), stage.id);
  });

  return rawEvents
    .filter((item: any) => matchesLocation(item.lead?.assignedTo, filters.location_id))
    .map((item: any) => {
      const fromStage = deriveFromStage(item, approvalsByLead, auditsByLead, stageIdByNameKey);
      const reason = reasonsById.get(item.reasonId);
      const changedBy = item.changedById === 'system'
        ? { displayName: 'System' }
        : usersById.get(item.changedById) || { displayName: 'Unknown User' };

      return {
        id: item.id,
        leadId: item.leadId,
        leadName: item.lead?.name || 'Unknown Lead',
        fromStageId: fromStage.id,
        fromStageName: fromStage.name,
        reasonId: item.reasonId,
        reasonName: reason?.name || SYSTEM_REASON_LABELS[item.reasonId] || 'Unknown Reason',
        changedById: item.changedById,
        changedByName: changedBy.displayName,
        remarks: item.remarks || null,
        createdAt: item.changedAt.toISOString(),
        createdAtDate: new Date(item.changedAt),
      };
    })
    .filter((item: NormalizedLOBEvent) => (filters.reason_id ? item.reasonId === filters.reason_id : true))
    .filter((item: NormalizedLOBEvent) => (filters.user_id ? item.changedById === filters.user_id : true))
    .filter((item: NormalizedLOBEvent) => (filters.stage ? item.fromStageId === filters.stage : true));
};

const countReferenceLeads = async (workspaceId: string, filters: LOBAnalysisQueryInput): Promise<number> => {
  const rows = await repository.countLeadsForAnalytics(workspaceId, {
    ...(filters.date_from || filters.date_to
      ? {
          createdAt: {
            ...(filters.date_from ? { gte: startOfDay(filters.date_from) } : {}),
            ...(filters.date_to ? { lte: endOfDay(filters.date_to) } : {}),
          },
        }
      : {}),
    ...(filters.user_id ? { assignedToId: filters.user_id } : {}),
  });

  return rows.filter((item: any) => matchesLocation(item.assignedTo, filters.location_id)).length;
};

export const getSummary = async (workspaceId: string, _actor: Actor, filters: LOBAnalysisQueryInput) => {
  await ensureModuleReady();

  const [events, totalLeads] = await Promise.all([
    normalizeLOBEvents(workspaceId, filters),
    countReferenceLeads(workspaceId, filters),
  ]);

  const stageCounts = new Map<string, number>();
  const reasonCounts = new Map<string, number>();

  events.forEach((item) => {
    stageCounts.set(item.fromStageName, (stageCounts.get(item.fromStageName) || 0) + 1);
    reasonCounts.set(item.reasonName, (reasonCounts.get(item.reasonName) || 0) + 1);
  });

  const totalLOBLeads = events.length;
  const lobPercentage = totalLeads > 0 ? Number(((totalLOBLeads / totalLeads) * 100).toFixed(2)) : 0;

  return {
    total_leads: totalLeads,
    total_lob_leads: totalLOBLeads,
    lob_percentage: lobPercentage,
    stage_wise: Array.from(stageCounts.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((left, right) => right.count - left.count),
    top_reasons: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count),
  };
};

export const getStageBreakdown = async (workspaceId: string, _actor: Actor, filters: LOBAnalysisQueryInput) => {
  await ensureModuleReady();

  const [events, totalReference] = await Promise.all([
    normalizeLOBEvents(workspaceId, filters),
    countReferenceLeads(workspaceId, filters),
  ]);

  const stageCounts = new Map<string, number>();
  events.forEach((item) => {
    stageCounts.set(item.fromStageName, (stageCounts.get(item.fromStageName) || 0) + 1);
  });

  const sorted = Array.from(stageCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count);

  return {
    labels: sorted.map((item) => item.label),
    lob_counts: sorted.map((item) => item.count),
    total_reference: totalReference,
  };
};

export const getAuditTrail = async (workspaceId: string, _actor: Actor, query: LOBAnalysisAuditQueryInput) => {
  await ensureModuleReady();

  const events = await normalizeLOBEvents(workspaceId, query);
  const sorted = [...events].sort((left, right) => right.createdAtDate.getTime() - left.createdAtDate.getTime());
  const skip = (query.page - 1) * query.limit;
  const pageRows = sorted.slice(skip, skip + query.limit);

  return {
    data: pageRows.map((item) => ({
      lead_id: item.leadId,
      lead_name: item.leadName,
      from_stage: item.fromStageName,
      from_stage_id: item.fromStageId,
      reason: item.reasonName,
      changed_by: item.changedByName,
      comment: item.remarks,
      created_at: item.createdAt,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / query.limit)),
    },
  };
};
