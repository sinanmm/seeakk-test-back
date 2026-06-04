import prisma from '../../config/prisma';
import { buildAccessWhere } from '../../modules/leads/leads.service';
import { normalizeFollowUpType } from '../../constants/followUpType';
import { isFollowUpPastDueDay } from './followupCalendar.util';
import { getWorkspaceTimeZone, mapFollowUpRecord } from './followupService';
import logger from '../../utils/logger';
import {
  hasOverdueHistory,
  markPendingFollowUpsOverdueForWorkspace,
  resolveCalendarOverdueStatus,
} from './followupOverduePersistence.service';
import { buildStageCalendarIndex } from './leadStageCalendar.util';

const db = prisma as any;
const PENDING = 'PENDING';
const MISSED = 'MISSED';

export { isFollowUpPastDueDay, wasExtendedAfterOverdue } from './followupCalendar.util';
export {
  hasOverdueHistory,
  resolveCalendarOverdueStatus,
  shouldShowCalendarOverdueRed,
} from './followupOverduePersistence.service';

const buildFollowUpIncludeWithStage = {
  lead: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      stageId: true,
      stage: { select: { id: true, name: true, color: true, stageShortForm: true, showInCalendar: true } },
    },
  },
  user: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  images: {
    orderBy: { createdAt: 'asc' as const },
    select: { id: true, url: true, createdAt: true },
  },
  activityLogs: {
    orderBy: { snoozedAt: 'desc' as const },
    include: {
      snoozedByUser: {
        select: { id: true, name: true, username: true, email: true },
      },
    },
  },
} as const;

export type OverdueMandatoryFollowUpItem = {
  id: string;
  leadId: string;
  leadName: string;
  customerName: string;
  leadStage: { id: string; name: string; color: string } | null;
  scheduledAt: string;
  status: string;
  type: string;
  description: string | null;
  overdueStatus: 'OVERDUE';
  assignedUserName: string;
  followUpNotes: string | null;
};

/** Mandatory gate: only follow-ups that are unresolved and still past-due on the calendar day. */
export const isActivelyMandatoryOverdue = (
  record: { status: string; scheduledAt: Date },
  timeZone: string,
  now = new Date(),
): boolean => {
  if (record.status === MISSED) {
    return true;
  }
  if (record.status === PENDING) {
    return isFollowUpPastDueDay(record.scheduledAt, timeZone, now);
  }
  return false;
};

export const getOverdueMandatoryFollowUps = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
): Promise<OverdueMandatoryFollowUpItem[]> => {
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  await markPendingFollowUpsOverdueForWorkspace(workspaceId);
  const leadAccess = await buildAccessWhere(workspaceId, actor);

  const records = await db.followUp.findMany({
    where: {
      workspaceId,
      userId: actor.id,
      status: { in: [PENDING, MISSED] },
      lead: {
        deletedAt: null,
        ...(Object.keys(leadAccess).length > 0 ? leadAccess : {}),
      },
    },
    orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }],
    include: buildFollowUpIncludeWithStage,
  });

  const now = new Date();

  const activeOverdue = records.filter((record: any) =>
    isActivelyMandatoryOverdue(record, timeZone, now),
  );

  logger.info('[OverdueFollowUp] mandatory overdue query', {
    userId: actor.id,
    workspaceId,
    candidateCount: records.length,
    activeOverdueCount: activeOverdue.length,
    activeOverdueIds: activeOverdue.map((row: any) => row.id),
  });

  return activeOverdue
    .map((record: any) => {
      const customerName = record.lead?.email?.trim() || record.lead?.phone?.trim() || record.lead?.name || '—';
      return {
        id: record.id,
        leadId: record.leadId,
        leadName: record.lead?.name || 'Lead',
        customerName,
        leadStage: record.lead?.stage
          ? { id: record.lead.stage.id, name: record.lead.stage.name, color: record.lead.stage.color }
          : null,
        scheduledAt: record.scheduledAt.toISOString(),
        status: record.status,
        type: normalizeFollowUpType(record.type),
        description: record.description,
        overdueStatus: 'OVERDUE' as const,
        assignedUserName: record.user?.name || record.user?.email || '—',
        followUpNotes: record.description || record.completionDescription || null,
      };
    });
};

export const getOverdueMandatorySessionState = async (
  workspaceId: string,
  actor: { id: string; roleId?: string | null; role?: { name?: string | null } | null },
) => {
  const items = await getOverdueMandatoryFollowUps(workspaceId, actor);
  return {
    overdueFollowupRequired: items.length > 0,
    overdueFollowupCount: items.length,
    items,
  };
};

export const mapCalendarFollowUpDetail = (record: any, timeZone: string) => {
  const mapped = mapFollowUpRecord(record);
  const customerName = record.lead?.email?.trim() || record.lead?.phone?.trim() || record.lead?.name || '—';
  const overdueStatus = resolveCalendarOverdueStatus(record, timeZone);
  const stageCalendar = record.lead?.stage
    ? buildStageCalendarIndex([record.lead.stage])
    : null;

  return {
    ...mapped,
    customerName,
    leadStage: record.lead?.stage
      ? {
          id: record.lead.stage.id,
          name: record.lead.stage.name,
          stageShortForm: stageCalendar?.shortForm(record.lead.stage.id) || null,
          calendarLabel: stageCalendar?.label(record.lead.stage.id, record.lead.stage.name) || record.lead.stage.name,
          color: record.lead.stage.color,
          showInCalendar: record.lead.stage.showInCalendar !== false,
        }
      : null,
    overdueStatus,
    isOverdue: Boolean(record.isOverdue),
    overdueAt: record.overdueAt ? record.overdueAt.toISOString() : null,
    completedAfterOverdue: Boolean(record.completedAfterOverdue),
    extendedAfterOverdue: Boolean(record.extendedAfterOverdue),
    followUpNotes: record.description || record.completionDescription || null,
    assignedUserName: mapped.user?.displayName || mapped.user?.name || '—',
  };
};
