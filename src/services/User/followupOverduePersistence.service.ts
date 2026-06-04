import moment from 'moment-timezone';
import prisma from '../../config/prisma';
import { isFollowUpPastDueDay, wasExtendedAfterOverdue } from './followupCalendar.util';
import { getWorkspaceTimeZone } from './followupService';

const db = prisma as any;
const PENDING = 'PENDING';

export type CalendarOverdueStatus = 'ON_TIME' | 'OVERDUE' | 'LATE_COMPLETED' | 'LATE_EXTENDED';

export type FollowUpOverdueFlags = {
  isOverdue?: boolean;
  overdueAt?: Date | null;
  completedAfterOverdue?: boolean;
  extendedAfterOverdue?: boolean;
  status?: string;
  scheduledAt?: Date;
  completedAt?: Date | null;
  previousFollowupDate?: Date | null;
  snoozedAt?: Date | null;
};

/** Midnight at the start of the calendar day after the scheduled follow-up (workspace TZ). */
export const computeOverdueAtForScheduledDate = (scheduledAt: Date, timeZone: string): Date =>
  moment.tz(scheduledAt, timeZone).add(1, 'day').startOf('day').toDate();

export const hasOverdueHistory = (followUp: FollowUpOverdueFlags): boolean =>
  Boolean(
    followUp.isOverdue ||
      followUp.completedAfterOverdue ||
      followUp.extendedAfterOverdue,
  );

/** Calendar/report red indicator — persisted flags or legacy schedule/snooze heuristics. */
export const shouldShowCalendarOverdueRed = (
  followUp: FollowUpOverdueFlags,
  timeZone: string,
): boolean => resolveCalendarOverdueStatus(followUp, timeZone) !== 'ON_TIME';

export const resolveCalendarOverdueStatus = (
  followUp: FollowUpOverdueFlags,
  timeZone: string,
): CalendarOverdueStatus => {
  if (followUp.completedAfterOverdue) {
    return 'LATE_COMPLETED';
  }
  if (followUp.extendedAfterOverdue) {
    return 'LATE_EXTENDED';
  }
  if (followUp.isOverdue) {
    if (followUp.status === PENDING) {
      return 'OVERDUE';
    }
    if (followUp.status === 'COMPLETED') {
      return 'LATE_COMPLETED';
    }
    return 'LATE_EXTENDED';
  }

  if (followUp.status === 'COMPLETED' && followUp.completedAt && followUp.scheduledAt) {
    const scheduledEnd = moment.tz(followUp.scheduledAt, timeZone).endOf('day');
    if (moment.tz(followUp.completedAt, timeZone).isAfter(scheduledEnd)) {
      return 'LATE_COMPLETED';
    }
  }

  if (
    followUp.previousFollowupDate &&
    followUp.snoozedAt &&
    wasExtendedAfterOverdue(
      { previousFollowupDate: followUp.previousFollowupDate, snoozedAt: followUp.snoozedAt },
      timeZone,
    )
  ) {
    return 'LATE_EXTENDED';
  }

  if (followUp.scheduledAt && isFollowUpPastDueDay(followUp.scheduledAt, timeZone) && followUp.status === PENDING) {
    return 'OVERDUE';
  }

  return 'ON_TIME';
};

/**
 * Permanently marks pending follow-ups whose scheduled calendar day has ended without completion/extension.
 */
export const markPendingFollowUpsOverdueForWorkspace = async (workspaceId: string): Promise<number> => {
  const timeZone = await getWorkspaceTimeZone(workspaceId);
  const now = new Date();

  const candidates = await db.followUp.findMany({
    where: {
      workspaceId,
      status: PENDING,
      isOverdue: false,
    },
    select: {
      id: true,
      scheduledAt: true,
    },
  });

  const toMark = candidates.filter((row: { scheduledAt: Date }) =>
    isFollowUpPastDueDay(row.scheduledAt, timeZone, now),
  );

  if (toMark.length === 0) {
    return 0;
  }

  await Promise.all(
    toMark.map((row: { id: string; scheduledAt: Date }) =>
      db.followUp.update({
        where: { id: row.id },
        data: {
          isOverdue: true,
          overdueAt: computeOverdueAtForScheduledDate(row.scheduledAt, timeZone),
        },
      }),
    ),
  );

  return toMark.length;
};

export const ensureFollowUpOverdueFlagsBeforeAction = async (
  followUp: FollowUpOverdueFlags & { id: string; workspaceId: string },
): Promise<FollowUpOverdueFlags & { id: string; workspaceId: string }> => {
  await markPendingFollowUpsOverdueForWorkspace(followUp.workspaceId);

  const refreshed = await db.followUp.findFirst({
    where: { id: followUp.id },
    select: {
      id: true,
      workspaceId: true,
      status: true,
      scheduledAt: true,
      completedAt: true,
      isOverdue: true,
      overdueAt: true,
      completedAfterOverdue: true,
      extendedAfterOverdue: true,
      previousFollowupDate: true,
      snoozedAt: true,
    },
  });

  return refreshed || followUp;
};

export const buildCompletionOverdueUpdate = (
  existing: FollowUpOverdueFlags,
  completedAt: Date,
  timeZone: string,
) => {
  const becameOverdue =
    Boolean(existing.isOverdue) ||
    isFollowUpPastDueDay(existing.scheduledAt!, timeZone, completedAt);

  const overdueAt =
    existing.overdueAt ||
    (existing.scheduledAt ? computeOverdueAtForScheduledDate(existing.scheduledAt, timeZone) : null);

  return {
    completedAfterOverdue: becameOverdue || Boolean(existing.completedAfterOverdue),
    isOverdue: becameOverdue ? true : Boolean(existing.isOverdue),
    overdueAt: becameOverdue ? overdueAt : existing.overdueAt ?? null,
  };
};

export const buildExtensionOverdueUpdate = (
  existing: FollowUpOverdueFlags,
  previousScheduledAt: Date,
  newScheduledAt: Date,
  snoozedAt: Date,
  timeZone: string,
) => {
  const wasAlreadyOverdue =
    Boolean(existing.isOverdue) || isFollowUpPastDueDay(previousScheduledAt, timeZone, snoozedAt);

  const extendedLate =
    wasAlreadyOverdue ||
    wasExtendedAfterOverdue({ previousFollowupDate: previousScheduledAt, snoozedAt }, timeZone);

  const overdueAt =
    existing.overdueAt ||
    (wasAlreadyOverdue ? computeOverdueAtForScheduledDate(previousScheduledAt, timeZone) : null);

  const newScheduleStillOverdue = isFollowUpPastDueDay(newScheduledAt, timeZone, snoozedAt);

  return {
    extendedAfterOverdue: extendedLate || Boolean(existing.extendedAfterOverdue),
    // Clear active overdue lock when rescheduled to a future calendar day (history flags remain).
    isOverdue: newScheduleStillOverdue ? wasAlreadyOverdue || Boolean(existing.isOverdue) : false,
    overdueAt: newScheduleStillOverdue ? overdueAt : extendedLate ? overdueAt : null,
  };
};
