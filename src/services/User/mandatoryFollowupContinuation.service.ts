import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import auditService from '../../services/Audit/auditService';
import { normalizeFollowUpType } from '../../constants/followUpType';
import { touchFollowUpTodayCachesAfterLeadMutation } from './followupService';
import type { SaveMandatoryFollowUpContinuationInput } from '../../validations/mandatoryFollowupValidation';
import { invalidateMandatoryFollowUpCache } from '../../middlewares/mandatoryFollowupMiddleware';

const PENDING = 'PENDING';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export type MandatoryFollowUpContinuationItem = {
  leadId: string;
  leadName: string;
  customerName: string;
  stageName: string;
  lifecycleName: string;
  lifecycleRemainingDays: number | null;
  maxFollowUpDate: string | null;
  previousFollowUpDate: string | null;
  previousFollowUpType: string | null;
  previousFollowUpNotes: string | null;
  overdueDays: number;
};

export type MandatoryFollowUpSessionState = {
  mandatoryFollowupRequired: boolean;
  mandatoryFollowupCount: number;
  items: MandatoryFollowUpContinuationItem[];
};

const isActiveLifecycleLead = (lead: {
  lifecycleId: string | null;
  isClosed: boolean;
  isLOB: boolean;
  stage: { isClosed: boolean; isLOB: boolean } | null;
}): boolean => {
  if (!lead.lifecycleId) return false;
  if (lead.isClosed || lead.isLOB) return false;
  if (lead.stage?.isClosed || lead.stage?.isLOB) return false;
  return true;
};

const resolveCustomerName = (lead: { name: string; email: string | null; phone: string | null }): string => {
  if (lead.email?.trim()) return lead.email.trim();
  if (lead.phone?.trim()) return lead.phone.trim();
  return lead.name;
};

const computeLifecycleRemainingDays = (stageExpiresAt: Date | null): number | null => {
  if (!stageExpiresAt) return null;
  const diffMs = stageExpiresAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
};

const pickReferenceFollowUp = (
  followUps: Array<{
    status: string;
    scheduledAt: Date;
    type: string;
    description: string | null;
    completionDescription: string | null;
  }>,
  now: Date,
) => {
  const overduePending = followUps.find((f) => f.status === PENDING && f.scheduledAt.getTime() <= now.getTime());
  if (overduePending) return overduePending;

  const missed = followUps.find((f) => f.status === 'MISSED');
  if (missed) return missed;

  const completed = followUps.find((f) => f.status === 'COMPLETED');
  if (completed) return completed;

  return followUps[0] || null;
};

const mapContinuationItem = (
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    stageExpiresAt: Date | null;
    stage: { name: string } | null;
    lifecycle: { name: string } | null;
    followUps: Array<{
      status: string;
      scheduledAt: Date;
      type: string;
      description: string | null;
      completionDescription: string | null;
    }>;
  },
  now: Date,
): MandatoryFollowUpContinuationItem => {
  const reference = pickReferenceFollowUp(lead.followUps, now);
  const previousDate = reference?.scheduledAt ?? null;
  const overdueDays =
    previousDate && previousDate.getTime() < now.getTime()
      ? Math.max(0, Math.floor((now.getTime() - previousDate.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;

  return {
    leadId: lead.id,
    leadName: lead.name,
    customerName: resolveCustomerName(lead),
    stageName: lead.stage?.name || '—',
    lifecycleName: lead.lifecycle?.name || '—',
    lifecycleRemainingDays: computeLifecycleRemainingDays(lead.stageExpiresAt),
    maxFollowUpDate: lead.stageExpiresAt ? lead.stageExpiresAt.toISOString().slice(0, 10) : null,
    previousFollowUpDate: previousDate ? previousDate.toISOString() : null,
    previousFollowUpType: reference ? normalizeFollowUpType(reference.type) : null,
    previousFollowUpNotes:
      reference?.completionDescription?.trim() ||
      reference?.description?.trim() ||
      null,
    overdueDays,
  };
};

export const listMandatoryFollowUpContinuations = async (
  workspaceId: string,
  actor: { id: string },
): Promise<MandatoryFollowUpContinuationItem[]> => {
  const now = new Date();

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      assignedToId: actor.id,
      lifecycleId: { not: null },
      isClosed: false,
      isLOB: false,
      stage: {
        isClosed: false,
        isLOB: false,
      },
      followUps: {
        none: {
          status: PENDING,
          scheduledAt: { gt: now },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      stageExpiresAt: true,
      stageEnteredAt: true,
      stageId: true,
      lifecycleId: true,
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
      followUps: {
        where: { userId: actor.id },
        orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          status: true,
          scheduledAt: true,
          type: true,
          description: true,
          completionDescription: true,
        },
      },
    },
    orderBy: [{ stageExpiresAt: 'asc' }, { updatedAt: 'desc' }],
    take: 50,
  });

  const { computeLifecycleExtensionContext } = await import('./followupLifecycleValidation.service');

  const activeLeads = leads.filter((lead) => isActiveLifecycleLead(lead));
  return Promise.all(
    activeLeads.map(async (lead) => {
      const base = mapContinuationItem(lead, now);
      const lifecycleContext = await computeLifecycleExtensionContext(workspaceId, lead as any);
      if (!lifecycleContext) {
        return base;
      }
      return {
        ...base,
        lifecycleRemainingDays: lifecycleContext.remainingDays,
        maxFollowUpDate: lifecycleContext.maxExtensionDate.slice(0, 10),
      };
    }),
  );
};

export const getMandatoryFollowUpSessionState = async (
  workspaceId: string,
  actor: { id: string },
): Promise<MandatoryFollowUpSessionState> => {
  const items = await listMandatoryFollowUpContinuations(workspaceId, actor);
  return {
    mandatoryFollowupRequired: items.length > 0,
    mandatoryFollowupCount: items.length,
    items,
  };
};

export const validateMandatoryFollowUpSchedule = async (
  workspaceId: string,
  leadId: string,
  lead: {
    stageExpiresAt: Date | null;
    lifecycleId: string | null;
    isClosed: boolean;
    isLOB: boolean;
    stage: { isClosed: boolean; isLOB: boolean } | null;
  },
  scheduledAt: Date,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
): Promise<void> => {
  if (!isActiveLifecycleLead(lead)) {
    throw createServiceError('This lead is no longer subject to mandatory lifecycle follow-up.', 409);
  }

  const { validateFollowUpLifecycleExtension } = await import('./followupLifecycleValidation.service');
  await validateFollowUpLifecycleExtension(workspaceId, leadId, scheduledAt, actor);
};

export const saveMandatoryFollowUpContinuation = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
  input: SaveMandatoryFollowUpContinuationInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  const lead = await prisma.lead.findFirst({
    where: {
      id: input.leadId.trim(),
      workspaceId,
      deletedAt: null,
      assignedToId: actor.id,
    },
    include: {
      stage: { select: { name: true, isClosed: true, isLOB: true } },
      lifecycle: { select: { id: true, name: true } },
    },
  });

  if (!lead) {
    throw createServiceError('Lead not found or you are not the assigned owner.', 404);
  }

  await validateMandatoryFollowUpSchedule(workspaceId, lead.id, lead, input.scheduledAt, actor);

  const now = new Date();
  const stillRequired = await prisma.lead.findFirst({
    where: {
      id: lead.id,
      workspaceId,
      assignedToId: actor.id,
      lifecycleId: { not: null },
      isClosed: false,
      isLOB: false,
      followUps: {
        none: {
          status: PENDING,
          scheduledAt: { gt: now },
        },
      },
    },
    select: { id: true },
  });

  if (!stillRequired) {
    throw createServiceError('A future follow-up is already scheduled for this lead.', 409);
  }

  const followUpType = normalizeFollowUpType(input.type);
  const description = input.description?.trim() || 'Mandatory lifecycle follow-up continuation';

  const created = await prisma.$transaction(async (tx) => {
    const pending = await tx.followUp.findFirst({
      where: { leadId: lead.id, workspaceId, status: PENDING },
      orderBy: { createdAt: 'desc' },
    });

    const followUp = pending
      ? await tx.followUp.update({
          where: { id: pending.id },
          data: {
            userId: actor.id,
            type: followUpType,
            description,
            scheduledAt: input.scheduledAt,
            status: PENDING,
          },
        })
      : await tx.followUp.create({
          data: {
            leadId: lead.id,
            userId: actor.id,
            workspaceId,
            type: followUpType,
            description,
            status: PENDING,
            scheduledAt: input.scheduledAt,
          },
        });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        nextFollowUpAt: input.scheduledAt,
      },
    });

    return followUp;
  });

  await touchFollowUpTodayCachesAfterLeadMutation(workspaceId, actor.id, input.scheduledAt);

  invalidateMandatoryFollowUpCache(actor.id);

  const { invalidateOverdueFollowUpCache } = await import('../../middlewares/overdueFollowupMiddleware');
  invalidateOverdueFollowUpCache(actor.id);

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'MANDATORY_FOLLOWUP_CONTINUATION_SAVED',
    entityType: 'Lead',
    entityId: lead.id,
    details: {
      followUpId: created.id,
      scheduledAt: input.scheduledAt.toISOString(),
      type: followUpType,
      lifecycleId: lead.lifecycleId,
      stageExpiresAt: lead.stageExpiresAt?.toISOString() ?? null,
      overdueDaysResolved: true,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return {
    followUpId: created.id,
    leadId: lead.id,
    scheduledAt: input.scheduledAt.toISOString(),
  };
};
