import prisma from '../../config/prisma';
import { redisClient } from '../../config/redis';
import { assertActiveLOBReason } from '../master/lob-reasons/lobReasons.service';
import * as repository from './leadApprovals.repository';
import type {
  CreateLeadApprovalInput,
  HandleLeadApprovalInput,
  ListLeadApprovalsQueryInput,
} from './leadApprovals.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

type SlaAction = 'AUTO_LOB' | 'WARN_AND_CHOOSE';
type ApprovalAction = 'APPROVE' | 'DENY';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const clearWorkspaceLeadCache = async (workspaceId: string): Promise<void> => {
  if (!redisClient.isOpen) return;

  try {
    const keysToDelete: string[] = [];
    const pattern = `leads:${workspaceId}:*`;

    for await (const key of (redisClient as any).scanIterator({ MATCH: pattern, COUNT: 250 })) {
      if (typeof key === 'string' && key.length > 0) {
        keysToDelete.push(key);
      }
    }

    if (keysToDelete.length === 0) {
      const keys = await (redisClient as any).keys(pattern);
      if (Array.isArray(keys)) {
        keysToDelete.push(...keys);
      }
    }

    if (keysToDelete.length > 0) {
      const uniqueKeysFinal = Array.from(new Set(keysToDelete));
      for (let i = 0; i < uniqueKeysFinal.length; i += 50) {
        const batch = uniqueKeysFinal.slice(i, i + 50);
        await redisClient.del(batch);
      }
    }
  } catch (error) {
    console.error('Failed to clear lead cache after approval action:', error);
  }
};

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string => {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.username?.trim()) return user.username.trim();
  return user?.email || 'Unknown user';
};

const addDays = (base: Date, days: number): Date => new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

const emptySlaSnapshot = () => ({
  stageEnteredAt: null as Date | null,
  stageExpiresAt: null as Date | null,
  slaAction: null as SlaAction | null,
  slaWarningDays: null as number | null,
});

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
) => {
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

const buildLeadSlaSnapshot = (
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
) => {
  const transition = resolveLifecycleTransition(lifecycle, stageId);
  if (!transition) return emptySlaSnapshot();

  return {
    stageEnteredAt: fromDate,
    stageExpiresAt: addDays(fromDate, transition.numberOfDays),
    slaAction: transition.expiryAction,
    slaWarningDays: transition.warningDays,
  };
};

const buildApprovalResponse = (approval: any) => ({
  ...approval,
  approvedAt: approval.approvedAt ? approval.approvedAt.toISOString() : null,
  createdAt: approval.createdAt.toISOString(),
  updatedAt: approval.updatedAt.toISOString(),
  requestedBy: approval.requestedBy
    ? { ...approval.requestedBy, displayName: resolveDisplayName(approval.requestedBy) }
    : null,
  assignedTo: approval.assignedTo
    ? { ...approval.assignedTo, displayName: resolveDisplayName(approval.assignedTo) }
    : null,
  approvedBy: approval.approvedBy
    ? { ...approval.approvedBy, displayName: resolveDisplayName(approval.approvedBy) }
    : null,
});

const normalizeRequestData = (requestData: unknown): Record<string, any> => {
  if (!requestData || typeof requestData !== 'object' || Array.isArray(requestData)) {
    return {};
  }

  return requestData as Record<string, any>;
};

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureLeadApprovalSchemaReady();
  if (!ready || !(prisma as any).leadStageApproval?.findFirst) {
    throw createServiceError(
      'Lead approval module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const isImmediateClosureStage = (stage?: { isClosed?: boolean | null; name?: string | null } | null): boolean =>
  Boolean(stage?.isClosed);

const buildApprovalLeadUpdateData = (approval: any) => {
  const now = new Date();
  const targetStage = approval.toStage;
  const isTerminal = Boolean(targetStage?.isLOB || targetStage?.isClosed);
  const slaSnapshot = isTerminal
    ? emptySlaSnapshot()
    : buildLeadSlaSnapshot(approval.lead?.lifecycle, targetStage?.id || null, now);

  const requestData = normalizeRequestData(approval.requestData);

  return {
    stageId: targetStage?.id || null,
    approvalState: 'NONE',
    pendingApprovalToStageId: null,
    pendingApprovalRequestedAt: null,
    stageEnteredAt: slaSnapshot.stageEnteredAt,
    stageExpiresAt: slaSnapshot.stageExpiresAt,
    slaAction: slaSnapshot.slaAction,
    slaWarningDays: slaSnapshot.slaWarningDays,
    isLOB: Boolean(targetStage?.isLOB),
    isClosed: Boolean(targetStage?.isLOB || targetStage?.isClosed),
    closedAt: targetStage?.isLOB || targetStage?.isClosed ? now : null,
    closedById: targetStage?.isLOB || targetStage?.isClosed ? approval.approvedById || null : null,
    closureType: targetStage?.isLOB ? 'LOST' : targetStage?.isClosed ? 'WON' : null,
    generatedRevenue: isTerminal ? Number(requestData.generatedRevenue) || 0 : undefined,
  };
};

export const createLeadApproval = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLeadApprovalInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();

  const lead = await repository.findLeadScoped(workspaceId, input.leadId);
  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  const targetStage = await repository.findStageById(workspaceId, input.toStageId);
  if (!targetStage) {
    throw createServiceError('Target lead stage was not found.', 404);
  }

  if (lead.isClosed || lead.isLOB) {
    throw createServiceError('Closed or LOB leads cannot request a stage approval.', 409);
  }

  if (!lead.stageId) {
    throw createServiceError('Lead does not have a current stage to approve from.', 409);
  }

  const existingPending = await repository.findPendingApprovalForLead(workspaceId, input.leadId);

  if (lead.approvalState === 'PENDING' && !existingPending) {
    await repository.clearLeadPendingApprovalState(input.leadId);
    lead.approvalState = 'NONE';
    lead.pendingApprovalToStageId = null;
    lead.pendingApprovalRequestedAt = null;
  }

  if (lead.approvalState === 'PENDING') {
    throw createServiceError('This lead already has a pending stage approval request.', 409);
  }

  if (input.fromStageId !== lead.stageId) {
    throw createServiceError('The requested approval does not match the lead’s current stage.', 409);
  }

  if (input.fromStageId === targetStage.id) {
    throw createServiceError('Lead is already in the requested stage.', 409);
  }

  if (!targetStage.isApprovalRequired) {
    throw createServiceError('This stage does not require approval.', 409);
  }

  let requestData = normalizeRequestData(input.requestData);
  if (targetStage.isLOB && lead.stageId) {
    const prevId =
      typeof requestData.previousStageId === 'string' && requestData.previousStageId.trim()
        ? requestData.previousStageId.trim()
        : lead.stageId;
    const prevName =
      typeof requestData.previousStageName === 'string' && requestData.previousStageName.trim()
        ? requestData.previousStageName.trim()
        : lead.stage?.name?.trim() || null;
    requestData = { ...requestData, previousStageId: prevId, previousStageName: prevName };
  }

  if (targetStage.isLOB) {
    const reasonId = typeof requestData.reasonId === 'string' ? requestData.reasonId.trim() : '';
    if (!reasonId) {
      throw createServiceError('LOB approval requests require a reason.', 422);
    }

    await assertActiveLOBReason(workspaceId, reasonId);
  }

  if (existingPending) {
    if (existingPending.fromStageId === input.fromStageId && existingPending.toStageId === input.toStageId) {
      throw createServiceError('An approval request for this lead stage transition is already pending.', 409);
    }

    throw createServiceError('This lead already has a pending stage approval request.', 409);
  }

  const leadSupervisorId = lead.assignedTo?.supervisorId || null;
  if (!leadSupervisorId) {
    throw createServiceError(
      'The selected staff member must have a supervisor before requesting a stage approval.',
      409,
    );
  }

  if (input.assignedToId && input.assignedToId !== leadSupervisorId) {
    throw createServiceError('Approval requests can only be assigned to the selected supervisor.', 409);
  }

  const assignedSupervisor = await repository.findActiveUserById(workspaceId, leadSupervisorId);
  if (!assignedSupervisor) {
    throw createServiceError('The selected supervisor is inactive or unavailable.', 409);
  }

  const assignedToId = assignedSupervisor.id;

  const approval = await repository.createApprovalRequest({
    workspaceId,
    leadId: input.leadId,
    fromStageId: input.fromStageId,
    toStageId: input.toStageId,
    requestedById: actor.id,
    assignedToId,
    requestData,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  const refreshedLead = await repository.findLeadScoped(workspaceId, input.leadId);

  return {
    approval: buildApprovalResponse(approval),
    lead: refreshedLead,
  };
};

export const listApprovals = async (workspaceId: string, actor: Actor, query: ListLeadApprovalsQueryInput) => {
  await ensureModuleReady();

  const where: any = { workspaceId, assignedToId: actor.id };
  if (query.status) where.status = query.status;
  if (query.assignedTo) where.assignedToId = query.assignedTo === actor.id ? actor.id : '__no_matching_approver__';
  if (query.requestedBy) where.requestedById = query.requestedBy;
  if (query.search) {
    where.OR = [
      {
        lead: {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        lead: {
          email: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        lead: {
          phone: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        requestedBy: {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        assignedTo: {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        fromStage: {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
      {
        toStage: {
          name: {
            contains: query.search,
            mode: 'insensitive',
          },
        },
      },
    ];
  }

  if (query.dateFrom || query.dateTo) {
    where.createdAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }

  const skip = (query.page - 1) * query.limit;
  const { total, rows } = await repository.listApprovals(where, skip, query.limit);

  return {
    approvals: rows.map(buildApprovalResponse),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
      hasNext: query.page < Math.max(1, Math.ceil(total / query.limit)),
      hasPrev: query.page > 1,
    },
  };
};

export const processLeadApproval = async (
  workspaceId: string,
  actor: Actor,
  approvalId: string,
  input: HandleLeadApprovalInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();

  const approval = await repository.getApprovalById(workspaceId, approvalId);
  if (!approval) {
    throw createServiceError('Approval not found.', 404);
  }

  if (approval.status !== 'PENDING') {
    throw createServiceError('This approval request has already been processed.', 409);
  }

  if (!approval.lead || approval.lead.deletedAt) {
    throw createServiceError('Lead not found or already archived.', 404);
  }

  if (!approval.assignedToId) {
    throw createServiceError('This approval request is not assigned to an approver.', 403);
  }
  if (approval.assignedToId !== actor.id) {
    throw createServiceError('This approval request is assigned to another approver.', 403);
  }

  const requestData = normalizeRequestData(approval.requestData);
  if (input.action === 'APPROVE' && requestData.nextFollowUpAt) {
    const parsedNextFollowUpAt = new Date(requestData.nextFollowUpAt);
    if (Number.isNaN(parsedNextFollowUpAt.getTime())) {
      throw createServiceError('Requested follow-up date is invalid.', 422);
    }

    if (parsedNextFollowUpAt.getTime() <= Date.now()) {
      throw createServiceError('Requested follow-up date must be in the future.', 422);
    }
  }

  const result = await repository.processApproval({
    workspaceId,
    approvalId,
    action: input.action,
    comment: input.comment,
    approvedById: actor.id,
    leadUpdateData:
      input.action === 'APPROVE'
        ? {
            ...buildApprovalLeadUpdateData({ ...approval, approvedById: actor.id }),
            ...(requestData.nextFollowUpAt
              ? {
                  nextFollowUpAt: new Date(requestData.nextFollowUpAt),
                }
              : {}),
          }
        : undefined,
    requestData,
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  if (!result) {
    throw createServiceError('Approval not found.', 404);
  }

  await clearWorkspaceLeadCache(workspaceId);

  const refreshedLead = approval.lead?.id
    ? await repository.findLeadScoped(workspaceId, approval.lead.id)
    : null;

  return {
    lead: refreshedLead,
    approval: buildApprovalResponse(result),
    message: 'Approval processed successfully',
  };
};
