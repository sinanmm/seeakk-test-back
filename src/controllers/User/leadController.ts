import { NextFunction, Request, Response } from 'express';
import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import logger from '../../utils/logger';
import * as leadService from '../../services/User/leadService';
import { emitWorkspaceEvent } from '../../realtime/socket';
import { getActiveStageRulesForExecution } from '../../modules/master/stage-rules/stageRule.service';
import { resolveWorkspaceIdForUser } from '../../utils/workspaceContext';
import type {
  AssignLeadInput,
  ChangeStageInput,
  CreateLeadInput,
  ExtendLeadSlaInput,
  ExportLeadsQueryInput,
  LeadIdParamInput,
  LeadStageRulesQueryInput,
  ListLeadsQueryInput,
  ToggleLeadStarInput,
  UpdateLeadInput,
} from '../../validations/leadValidation';
import {
  assignLeadSchema,
  changeStageSchema,
  createLeadSchema,
  extendLeadSlaSchema,
  exportLeadsQuerySchema,
  leadIdParamSchema,
  leadStageRulesQuerySchema,
  listLeadsQuerySchema,
  toggleLeadStarSchema,
  updateLeadSchema,
} from '../../validations/leadValidation';

const normalizeStageKey = (value?: string | null): string =>
  (value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const requireWorkspace = (req: Request, res: Response): string | null => {
  // Use the shared resolver so we don't break meta endpoints when
  // `req.user.workspaceId` is missing but a workspace can be inferred.
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) {
    res.status(403).json({
      success: false,
      message: 'Forbidden: No workspace linked to your account.',
    });
    return null;
  }
  return workspaceId;
};

function validate<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: any } },
  data: unknown,
  res: Response,
): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    res.status(422).json({
      success: false,
      message: 'Validation failed.',
      errors: result.error.flatten().fieldErrors,
    });
    return null;
  }

  return result.data as T;
}

const handleServiceError = (error: any, res: Response, next: NextFunction, action: string): void => {
  if (error?.code === 'P2021' || error?.code === 'P2022') {
    const meta = error?.meta as { column?: string; table?: string; modelName?: string } | undefined;
    const detail =
      error?.code === 'P2022'
        ? `Database column out of sync (missing: ${meta?.column ?? 'unknown'}).`
        : `Database table out of sync (missing: ${meta?.table ?? meta?.modelName ?? 'unknown'}).`;
    logger.error(`Lead schema mismatch (${error?.code})`, { action, meta: error?.meta, message: error?.message });
    res.status(503).json({
      success: false,
      message: `Leads module is not ready. ${detail} Run \`npx prisma migrate deploy\` on the production database for this service's DATABASE_URL, then restart the API.`,
    });
    return;
  }

  if (error?.statusCode) {
    const isConflict = error.statusCode === 409;
    logger.error(`Lead service error during ${action}`, {
      action,
      statusCode: error.statusCode,
      message: error?.message,
      stack: error?.stack,
    });
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(isConflict ? { code: 'DUPLICATE_LEAD' } : {}),
    });
    return;
  }

  logger.error(`Lead error during ${action}`, {
    action,
    name: error?.name,
    code: error?.code,
    meta: error?.meta,
    message: error?.message,
    stack: error?.stack,
  });
  next(error);
};

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user?.roleId,
  role: req.user?.role,
});

export const createLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const input = validate<CreateLeadInput>(createLeadSchema, req.body, res);
  if (!input) return;

  try {
    const { lead, autoSelfAssigned } = await leadService.createLead(workspaceId, getActor(req), input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'created' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_CREATED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        name: lead.name,
        assignedToId: lead.assignedToId,
        ...(autoSelfAssigned
          ? {
              assignmentType: 'Auto Self Assignment',
              assignedUser: lead.assignedToId,
            }
          : {}),
        stageId: lead.stageId,
        sourceId: lead.sourceId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'createLead');
  }
};

export const listLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ListLeadsQueryInput>(listLeadsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const result = await leadService.getLeads(workspaceId, query, getActor(req));
    return res.status(200).json({
      success: true,
      message: 'Leads fetched successfully',
      leads: result.leads,
      pagination: result.pagination,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeads');
  }
};

export const getLeadById = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    const lead = await leadService.getLeadById(workspaceId, params.id, getActor(req));
    return res.status(200).json({
      success: true,
      message: 'Lead fetched successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLeadById');
  }
};

export const toggleLeadStar = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ToggleLeadStarInput>(toggleLeadStarSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadService.setLeadStar(workspaceId, getActor(req), params.id, input.starred);
    emitWorkspaceEvent(workspaceId, 'lead_updated', {
      leadId: params.id,
      action: input.starred ? 'starred' : 'unstarred',
    });

    return res.status(200).json({
      success: true,
      message: input.starred ? 'Lead starred successfully' : 'Lead unstarred successfully',
      data: result,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'toggleLeadStar');
  }
};

export const updateLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<UpdateLeadInput>(updateLeadSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadService.updateLead(workspaceId, getActor(req), params.id, input);
    
    if ((result as any)._approvalRequired) {
      // The other updates (name, etc) were saved, but stage requires approval
      emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: result.id, action: 'updated' });
      return res.status(202).json({
        success: true,
        message: 'Approval required for stage change. Other updates were saved successfully.',
        approvalRequired: true,
        data: {
          lead: result,
          approval: (result as any)._approval,
        },
      });
    }

    const lead = result;
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'updated' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_UPDATED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        updatedFields: Object.keys(req.body || {}),
        assignedToId: lead.assignedToId,
        stageId: lead.stageId,
        nextFollowUpAt: lead.nextFollowUpAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead updated successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'updateLead');
  }
};

export const changeStage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ChangeStageInput>(changeStageSchema, req.body, res);
  if (!input) return;

  try {
    const result = await leadService.changeStage(workspaceId, getActor(req), params.id, input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'stage_changed' });

    if (result.approvalRequired) {
      return res.status(202).json({
        success: true,
        message: 'Approval required. Stage change request created successfully.',
        approvalRequired: true,
        data: {
          lead: result.lead,
          approval: result.approval,
        },
      });
    }

    const lead = result.lead;
    const isClosureStage = Boolean(lead.stage?.isClosed);
    const action = lead.isLOB
      ? 'LEAD_LOB_APPLIED'
      : lead.isClosed && isClosureStage
        ? 'LEAD_CLOSED'
        : 'LEAD_STAGE_CHANGED';

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action,
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        stageId: lead.stageId,
        isLOB: lead.isLOB,
        isClosed: lead.isClosed,
        generatedRevenue: (lead as any).generatedRevenue,
        reasonId: input.reasonId,
        remarks: input.remarks,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead stage updated successfully',
      approvalRequired: false,
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'changeStage');
  }
};

export const assignLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<AssignLeadInput>(assignLeadSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.assignLead(workspaceId, getActor(req), params.id, input);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'reassigned' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_ASSIGNED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        assignedToId: lead.assignedToId,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead assignment updated successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'assignLead');
  }
};

export const extendLeadSla = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  const input = validate<ExtendLeadSlaInput>(extendLeadSlaSchema, req.body, res);
  if (!input) return;

  try {
    const lead = await leadService.extendLeadSla(workspaceId, params.id, input.extraDays);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: lead.id, action: 'sla_extended' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_SLA_EXTENDED',
      entityType: 'Lead',
      entityId: lead.id,
      details: {
        extraDays: input.extraDays,
        stageExpiresAt: (lead as any).stageExpiresAt,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead lifecycle timer extended successfully',
      data: lead,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'extendLeadSla');
  }
};

export const deleteLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadService.deleteLead(workspaceId, params.id);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'archived' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_ARCHIVED',
      entityType: 'Lead',
      entityId: params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead archived successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'deleteLead');
  }
};

export const permanentlyDeleteLead = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const params = validate<LeadIdParamInput>(leadIdParamSchema, req.params, res);
  if (!params) return;

  try {
    await leadService.permanentlyDeleteLead(workspaceId, params.id);
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadId: params.id, action: 'deleted' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: 'LEAD_PERMANENTLY_DELETED',
      entityType: 'Lead',
      entityId: params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: 'Lead permanently deleted successfully',
    });
  } catch (error) {
    handleServiceError(error, res, next, 'permanentlyDeleteLead');
  }
};

export const bulkDeleteLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const { ids, permanent } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(422).json({
      success: false,
      message: 'Lead IDs are required and must be an array.',
    });
  }

  try {
    await leadService.bulkDeleteLeads(workspaceId, ids, Boolean(permanent));
    emitWorkspaceEvent(workspaceId, 'lead_updated', { leadIds: ids, action: permanent ? 'bulk_deleted' : 'bulk_archived' });

    await auditService.log({
      userId: req.user?.id,
      workspaceId,
      action: permanent ? 'LEADS_BULK_PERMANENTLY_DELETED' : 'LEADS_BULK_ARCHIVED',
      entityType: 'Lead',
      entityId: 'multiple',
      details: {
        count: ids.length,
        ids: ids.slice(0, 50), // Log first 50 for safety
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      message: `${ids.length} leads ${permanent ? 'permanently deleted' : 'archived'} successfully`,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'bulkDeleteLeads');
  }
};

export const exportLeads = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<ExportLeadsQueryInput>(exportLeadsQuerySchema, req.query, res);
  if (!query) return;

  try {
    const exported = await leadService.exportLeads(workspaceId, query, getActor(req));
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`);
    return res.status(200).send(exported.content);
  } catch (error) {
    handleServiceError(error, res, next, 'exportLeads');
  }
};

export const listLeadAssignees = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  // Meta endpoints should still work even if `req.user.workspaceId` is not set.
  const workspaceId =
    req.user?.workspaceId?.trim() ||
    (await resolveWorkspaceIdForUser(req.user!.id, req.user?.workspaceId ?? null));
  if (!workspaceId) return requireWorkspace(req, res);

  try {
    const actor = getActor(req);
    const users = await prisma.user.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Lead assignees fetched successfully',
      data: users,
      meta: {
        canAssignOtherUsers: await leadService.canAssignOtherUsers(actor),
      },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadAssignees');
  }
};

export const listLeadTransitionStageRules = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const query = validate<LeadStageRulesQueryInput>(leadStageRulesQuerySchema, req.query, res);
  if (!query) return;

  try {
    const data = await getActiveStageRulesForExecution(workspaceId, query.stageId);
    return res.status(200).json({
      success: true,
      message: 'Lead transition stage rules fetched successfully',
      data,
      pagination: {
        page: 1,
        limit: data.length || 100,
        total: data.length,
        totalPages: 1,
      },
    });
  } catch (error) {
    handleServiceError(error, res, next, 'listLeadTransitionStageRules');
  }
};

export const getLeadHistory = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
  const workspaceId = requireWorkspace(req, res);
  if (!workspaceId) return;

  const actor = req.user;
  if (!actor) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const id = req.params.id as string;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: { id: true },
    });

    if (!lead) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const [
      auditLogs,
      leadActivities,
      stageHistories,
      amountHistories,
      advancePayments,
      lobLogs,
    ] = await Promise.all([
      prisma.auditLog.findMany({ where: { entityType: 'Lead', entityId: id, workspaceId } }),
      prisma.leadActivity.findMany({ where: { leadId: id, workspaceId }, include: { performedBy: { select: { name: true, email: true } } } }),
      prisma.leadStageHistory.findMany({ where: { leadId: id, workspaceId } }),
      prisma.leadTotalAmountHistory.findMany({ where: { leadId: id }, include: { changedBy: { select: { name: true, email: true } } } }),
      prisma.advancePayment.findMany({ where: { leadId: id, workspaceId }, include: { requestedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, rejectedBy: { select: { name: true } } } }),
      prisma.leadLOBLog.findMany({ where: { leadId: id, workspaceId } }),
    ]);

    // Collect user IDs that need mapping
    const userIdsToFetch = new Set<string>();
    auditLogs.forEach(log => { if (log.userId) userIdsToFetch.add(log.userId); });
    stageHistories.forEach(log => { if (log.changedById) userIdsToFetch.add(log.changedById); });
    lobLogs.forEach(log => { if (log.changedById) userIdsToFetch.add(log.changedById); });

    const usersMap: Record<string, string> = {};
    if (userIdsToFetch.size > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: Array.from(userIdsToFetch) } },
        select: { id: true, name: true },
      });
      users.forEach(u => { usersMap[u.id] = u.name || 'System'; });
    }

    const timeline: any[] = [];

    auditLogs.forEach(log => {
      timeline.push({
        id: log.id,
        eventType: 'AUDIT',
        title: log.action,
        description: `Lead audited: ${log.action}`,
        timestamp: log.createdAt,
        user: log.userId ? { name: usersMap[log.userId] || 'System' } : null,
        metadata: log.details,
      });
    });

    leadActivities.forEach((log: any) => {
      timeline.push({
        id: log.id,
        eventType: 'ACTIVITY',
        title: log.action.replace(/_/g, ' '),
        description: `Activity recorded: ${log.action}`,
        timestamp: log.createdAt,
        user: log.performedBy,
        metadata: log.metadata,
      });
    });

    stageHistories.forEach(log => {
      timeline.push({
        id: log.id,
        eventType: 'STAGE_CHANGE',
        title: 'Stage Changed',
        description: `Stage changed from ${log.fromStageName || 'None'} to ${log.toStageName || 'None'}`,
        timestamp: log.changedAt,
        user: { name: usersMap[log.changedById] || 'System' },
        metadata: { fromStageId: log.fromStageId, toStageId: log.toStageId },
      });
    });

    amountHistories.forEach((log: any) => {
      timeline.push({
        id: log.id,
        eventType: 'AMOUNT_CHANGE',
        title: 'Total Amount Changed',
        description: log.reason || `Amount updated from ${log.oldAmount} to ${log.newAmount}`,
        timestamp: log.createdAt,
        user: log.changedBy,
        metadata: { oldAmount: log.oldAmount, newAmount: log.newAmount },
      });
    });

    advancePayments.forEach((log: any) => {
      timeline.push({
        id: `adv_${log.id}_req`,
        eventType: 'PAYMENT',
        title: 'Advance Payment Requested',
        description: `Amount: ${log.amount}, Remarks: ${log.remarks || 'None'}`,
        timestamp: log.createdAt,
        user: log.requestedBy,
        metadata: { advancePaymentId: log.id, status: log.status, amount: log.amount },
      });
      if (log.approvedAt && log.approvedBy) {
        timeline.push({
          id: `adv_${log.id}_app`,
          eventType: 'PAYMENT_APPROVAL',
          title: 'Advance Payment Approved',
          description: `Approved by ${log.approvedBy.name}`,
          timestamp: log.approvedAt,
          user: log.approvedBy,
          metadata: { advancePaymentId: log.id, status: 'APPROVED' },
        });
      }
      if (log.rejectedAt && log.rejectedBy) {
        timeline.push({
          id: `adv_${log.id}_rej`,
          eventType: 'PAYMENT_REJECTION',
          title: 'Advance Payment Rejected',
          description: `Rejected by ${log.rejectedBy.name}. Reason: ${log.rejectionReason || 'None'}`,
          timestamp: log.rejectedAt,
          user: log.rejectedBy,
          metadata: { advancePaymentId: log.id, status: 'REJECTED' },
        });
      }
    });

    lobLogs.forEach(log => {
      timeline.push({
        id: log.id,
        eventType: 'LOB',
        title: 'Lead Marked LOB',
        description: log.remarks || 'Lead was marked as Lost Opportunity',
        timestamp: log.changedAt,
        user: { name: usersMap[log.changedById] || 'System' },
        metadata: { reasonId: log.reasonId, previousStageName: log.previousStageName },
      });
    });

    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return res.status(200).json({
      success: true,
      message: 'Lead history fetched successfully',
      data: timeline,
    });
  } catch (error) {
    handleServiceError(error, res, next, 'getLeadHistory');
  }
};
