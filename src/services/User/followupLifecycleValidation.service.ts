import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import { getWorkspaceTimeZone } from './followupService';

const db = prisma as any;

const PRIVILEGED_ROLES = new Set(['superadmin', 'admin', 'administrator']);

export type LifecycleExtensionContext = {
  applies: boolean;
  leadId: string;
  stageId: string | null;
  stageName: string | null;
  lifecycleName: string | null;
  configuredTransitionDays: number;
  daysConsumed: number;
  remainingDays: number;
  maxExtensionDate: string;
  stageEnteredAt: string | null;
  stageExpiresAt: string | null;
};

type LeadLifecycleRow = {
  id: string;
  stageId: string | null;
  lifecycleId: string | null;
  stageEnteredAt: Date | null;
  stageExpiresAt: Date | null;
  isClosed: boolean;
  isLOB: boolean;
  stage: { id: string; name: string; isClosed: boolean; isLOB: boolean } | null;
  lifecycle: {
    id: string;
    name: string;
    transitions: Array<{ fromStageId: string; toStageId: string; numberOfDays: number }>;
  } | null;
};

const createServiceError = (message: string, statusCode: number, errorCode?: string) => {
  const error = new Error(message) as Error & { statusCode: number; errorCode?: string };
  error.statusCode = statusCode;
  if (errorCode) error.errorCode = errorCode;
  return error;
};

export const isPrivilegedActorRole = (roleName?: string | null): boolean =>
  PRIVILEGED_ROLES.has((roleName || '').toLowerCase().trim());

export const loadActorPermissionKeys = async (roleId?: string | null): Promise<string[]> => {
  if (!roleId) return [];
  const rows = await db.rolePermission.findMany({
    where: { roleId },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((row: { permission: { key: string } }) => row.permission.key);
};

export const actorCanOverrideLifecycleFollowUpLimit = async (actor: {
  role?: { name?: string | null } | null;
  roleId?: string | null;
}): Promise<boolean> => {
  if (isPrivilegedActorRole(actor.role?.name)) return true;
  const permissions = await loadActorPermissionKeys(actor.roleId);
  return (
    permissions.includes('override_lifecycle_followup_limit') ||
    permissions.includes('SYSTEM_CONFIG')
  );
};

const resolveTransitionForStage = (lead: LeadLifecycleRow) => {
  if (!lead.lifecycleId || !lead.stageId || !lead.lifecycle?.transitions?.length) {
    return null;
  }
  return lead.lifecycle.transitions.find((transition) => transition.fromStageId === lead.stageId) || null;
};

export const computeLifecycleExtensionContext = async (
  workspaceId: string,
  lead: LeadLifecycleRow,
): Promise<LifecycleExtensionContext | null> => {
  if (!lead.lifecycleId || !lead.stageId || lead.isClosed || lead.isLOB) {
    return null;
  }
  if (lead.stage?.isClosed || lead.stage?.isLOB) {
    return null;
  }

  const transition = resolveTransitionForStage(lead);
  if (!transition || transition.numberOfDays <= 0) {
    return null;
  }

  if (!lead.stageEnteredAt) {
    return null;
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const enteredDay = moment.tz(lead.stageEnteredAt, timeZone).startOf('day');
  const today = moment.tz(new Date(), timeZone).startOf('day');
  const daysConsumed = Math.max(0, today.diff(enteredDay, 'days'));
  const remainingDays = Math.max(0, transition.numberOfDays - daysConsumed);
  const maxExtensionMoment = today.clone().add(remainingDays, 'days').endOf('day');

  if (lead.stageExpiresAt) {
    const expiresMoment = moment.tz(lead.stageExpiresAt, timeZone).endOf('day');
    if (expiresMoment.isBefore(maxExtensionMoment)) {
      maxExtensionMoment.set({
        year: expiresMoment.year(),
        month: expiresMoment.month(),
        date: expiresMoment.date(),
        hour: expiresMoment.hour(),
        minute: expiresMoment.minute(),
        second: expiresMoment.second(),
        millisecond: expiresMoment.millisecond(),
      });
    }
  }

  return {
    applies: true,
    leadId: lead.id,
    stageId: lead.stageId,
    stageName: lead.stage?.name || null,
    lifecycleName: lead.lifecycle?.name || null,
    configuredTransitionDays: transition.numberOfDays,
    daysConsumed,
    remainingDays,
    maxExtensionDate: maxExtensionMoment.toISOString(),
    stageEnteredAt: lead.stageEnteredAt.toISOString(),
    stageExpiresAt: lead.stageExpiresAt ? lead.stageExpiresAt.toISOString() : null,
  };
};

export const getLifecycleExtensionContextForLead = async (
  workspaceId: string,
  leadId: string,
): Promise<LifecycleExtensionContext | null> => {
  const lead = await db.lead.findFirst({
    where: { id: leadId, workspaceId, deletedAt: null },
    select: {
      id: true,
      stageId: true,
      lifecycleId: true,
      stageEnteredAt: true,
      stageExpiresAt: true,
      isClosed: true,
      isLOB: true,
      stage: { select: { id: true, name: true, isClosed: true, isLOB: true } },
      lifecycle: {
        select: {
          id: true,
          name: true,
          transitions: {
            select: { fromStageId: true, toStageId: true, numberOfDays: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found in this workspace.', 404);
  }

  return computeLifecycleExtensionContext(workspaceId, lead);
};

export const logFollowUpLifecycleExtensionAudit = async (params: {
  workspaceId: string;
  userId: string;
  leadId: string;
  context: LifecycleExtensionContext;
  selectedFollowUpDate: Date;
  overrideUsed: boolean;
  followUpId?: string;
  ipAddress?: string;
  userAgent?: string;
}) => {
  await auditService.log({
    userId: params.userId,
    workspaceId: params.workspaceId,
    action: params.overrideUsed
      ? 'FOLLOWUP_LIFECYCLE_EXTENSION_OVERRIDE'
      : 'FOLLOWUP_LIFECYCLE_EXTENSION_VALIDATED',
    entityType: 'Lead',
    entityId: params.leadId,
    details: {
      followUpId: params.followUpId || null,
      leadStage: params.context.stageName,
      lifecycleName: params.context.lifecycleName,
      lifecycleDaysConfigured: params.context.configuredTransitionDays,
      daysConsumed: params.context.daysConsumed,
      remainingDays: params.context.remainingDays,
      stageEnteredAt: params.context.stageEnteredAt,
      selectedFollowUpDate: params.selectedFollowUpDate.toISOString(),
      maxExtensionDate: params.context.maxExtensionDate,
      overrideUsed: params.overrideUsed,
    },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
};

export const validateFollowUpLifecycleExtension = async (
  workspaceId: string,
  leadId: string,
  scheduledAt: Date,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  options?: {
    followUpId?: string;
    allowPast?: boolean;
    auditContext?: { ipAddress?: string; userAgent?: string };
  },
): Promise<LifecycleExtensionContext | null> => {
  const context = await getLifecycleExtensionContextForLead(workspaceId, leadId);
  if (!context) {
    return null;
  }

  const overrideUsed = await actorCanOverrideLifecycleFollowUpLimit(actor);
  if (overrideUsed) {
    await logFollowUpLifecycleExtensionAudit({
      workspaceId,
      userId: actor.id,
      leadId,
      context,
      selectedFollowUpDate: scheduledAt,
      overrideUsed: true,
      followUpId: options?.followUpId,
      ipAddress: options?.auditContext?.ipAddress,
      userAgent: options?.auditContext?.userAgent,
    });
    return context;
  }

  const now = new Date();
  if (!options?.allowPast && scheduledAt.getTime() <= now.getTime()) {
    throw createServiceError('Follow-up date must be in the future.', 422);
  }

  if (context.remainingDays <= 0) {
    throw createServiceError(
      'This lead has reached its maximum lifecycle period in the current stage. Please move the lead to the next stage.',
      422,
      'LIFECYCLE_EXTENSION_EXHAUSTED',
    );
  }

  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const scheduledDay = moment.tz(scheduledAt, timeZone).startOf('day');
  const maxDay = moment.tz(context.maxExtensionDate, timeZone).startOf('day');

  if (scheduledDay.isAfter(maxDay)) {
    throw createServiceError(
      `Selected follow-up date exceeds the remaining lifecycle period for this stage. Maximum allowed extension is ${context.remainingDays} more day${context.remainingDays === 1 ? '' : 's'}.`,
      422,
      'LIFECYCLE_EXTENSION_EXCEEDED',
    );
  }

  await logFollowUpLifecycleExtensionAudit({
    workspaceId,
    userId: actor.id,
    leadId,
    context,
    selectedFollowUpDate: scheduledAt,
    overrideUsed: false,
    followUpId: options?.followUpId,
    ipAddress: options?.auditContext?.ipAddress,
    userAgent: options?.auditContext?.userAgent,
  });

  return context;
};
