import prisma from '../../../config/prisma';
import type { SummaryFilterDto } from './summaryReports.service';
import { getWorkspaceTimeZone } from '../../../services/User/followupService';
import moment from 'moment-timezone';

const db = prisma as any;

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string } | null): string => {
  if (!user) return 'Unknown';
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return user.username.trim();
  return user.email || 'Unknown';
};

const getUserFilter = (userId?: string | string[]) => {
  if (!userId) return undefined;
  if (Array.isArray(userId) && userId.length > 0) return { in: userId };
  if (typeof userId === 'string') return userId;
  return undefined;
};

const getUserFilterIds = (userId?: string | string[]): string[] | undefined => {
  if (!userId) return undefined;
  if (Array.isArray(userId)) return userId.filter(Boolean);
  return userId ? [userId] : undefined;
};

const getEffectiveUserFilter = async (filters: SummaryFilterDto) => {
  const officeId = filters.officeId || filters.branchId;
  const explicitUserIds = getUserFilterIds(filters.userId);
  if (!officeId) return getUserFilter(filters.userId);

  const officeUsers = await db.user.findMany({
    where: { workspaceId: filters.workspaceId, officeId, deletedAt: null },
    select: { id: true },
  });
  const officeUserIds = officeUsers.map((user: { id: string }) => user.id);
  const scopedIds = explicitUserIds
    ? explicitUserIds.filter((id) => officeUserIds.includes(id))
    : officeUserIds;
  return { in: scopedIds };
};

const getScheduledDateFilter = async (workspaceId: string, startDate?: string, endDate?: string) => {
  if (startDate && endDate) {
    const tz = await getWorkspaceTimeZone(workspaceId);
    return {
      gte: moment.tz(startDate, tz).startOf('day').toDate(),
      lte: moment.tz(endDate, tz).endOf('day').toDate(),
    };
  }
  return undefined;
};

const followUpReportInclude = {
  user: {
    select: { id: true, name: true, username: true, email: true },
  },
  lead: {
    select: {
      id: true,
      name: true,
      phone: true,
      assignedTo: {
        select: { id: true, name: true, username: true, email: true },
      },
    },
  },
  activityLogs: {
    orderBy: { snoozedAt: 'asc' as const },
    include: {
      snoozedByUser: {
        select: { id: true, name: true, username: true, email: true },
      },
    },
  },
};

const buildFollowUpReportWhere = async (filters: SummaryFilterDto) => {
  const where: any = { workspaceId: filters.workspaceId };
  const dateFilter = await getScheduledDateFilter(filters.workspaceId, filters.startDate, filters.endDate);
  
  if (dateFilter) {
    where.OR = [
      { scheduledAt: dateFilter },
      { createdAt: dateFilter },
      { completedAt: dateFilter },
      { snoozedAt: dateFilter },
      {
        activityLogs: {
          some: {
            snoozedAt: dateFilter,
          },
        },
      },
    ];
  }

  const userFilter = await getEffectiveUserFilter(filters);
  if (userFilter) where.userId = userFilter;

  return where;
};

export type FollowupNoteEntry = {
  noteNumber: number;
  date: string;
  time: string;
  addedBy: string;
  note: string;
};

export type FollowupExtensionEntry = {
  originalDate: string;
  extendedTo: string;
  reason: string | null;
  description: string;
  extendedBy: string;
  extendedAt: string;
};

export type FollowupTimelineEntry = {
  date: string;
  time: string;
  event: string;
  detail?: string;
  reason?: string;
};

export type FollowupDetailReportItem = {
  id: string;
  leadId: string;
  leadName: string;
  assignedUser: string;
  followupType: string;
  createdDate: string;
  scheduledDate: string;
  status: string;
  notes: FollowupNoteEntry[];
  completion?: {
    note: string;
    completedAt: string;
    completedBy: string;
  };
  extensions: FollowupExtensionEntry[];
  timeline: FollowupTimelineEntry[];
};

const formatDateParts = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  return {
    date: date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
    iso: date.toISOString(),
  };
};

const mapExtensions = (record: any): FollowupExtensionEntry[] => {
  const logs = Array.isArray(record.activityLogs) ? record.activityLogs : [];
  const mapped = logs.map((log: any) => {
    const parts = formatDateParts(log.snoozedAt);
    return {
      originalDate: formatDateParts(log.previousFollowupDate).date,
      extendedTo: formatDateParts(log.newFollowupDate).date,
      reason: log.extensionReasonName || null,
      description: log.recentDescription || '',
      extendedBy: resolveDisplayName(log.snoozedByUser),
      extendedAt: parts.iso,
    };
  });

  if (mapped.length === 0 && record.previousFollowupDate && record.newFollowupDate) {
    mapped.push({
      originalDate: formatDateParts(record.previousFollowupDate).date,
      extendedTo: formatDateParts(record.newFollowupDate).date,
      reason: record.extensionReasonName || null,
      description: record.recentDescription || '',
      extendedBy: resolveDisplayName(record.user),
      extendedAt: record.snoozedAt ? formatDateParts(record.snoozedAt).iso : formatDateParts(record.updatedAt).iso,
    });
  }

  return mapped;
};

const mapNotes = (record: any): FollowupNoteEntry[] => {
  const notes: FollowupNoteEntry[] = [];

  if (record.description?.trim()) {
    const parts = formatDateParts(record.createdAt);
    notes.push({
      noteNumber: notes.length + 1,
      date: parts.date,
      time: parts.time,
      addedBy: resolveDisplayName(record.user),
      note: record.description.trim(),
    });
  }

  const logs = Array.isArray(record.activityLogs) ? record.activityLogs : [];
  logs.forEach((log: any) => {
    if (!log.recentDescription?.trim()) return;
    const parts = formatDateParts(log.snoozedAt);
    notes.push({
      noteNumber: notes.length + 1,
      date: parts.date,
      time: parts.time,
      addedBy: resolveDisplayName(log.snoozedByUser),
      note: log.recentDescription.trim(),
    });
  });

  return notes;
};

const mapTimeline = (record: any): FollowupTimelineEntry[] => {
  const events: Array<FollowupTimelineEntry & { sortMs: number }> = [];

  const createdParts = formatDateParts(record.createdAt);
  events.push({
    sortMs: new Date(record.createdAt).getTime(),
    date: createdParts.date,
    time: createdParts.time,
    event: 'Followup Created',
  });

  if (record.description?.trim()) {
    const parts = formatDateParts(record.createdAt);
    events.push({
      sortMs: new Date(record.createdAt).getTime(),
      date: parts.date,
      time: parts.time,
      event: 'Note Added',
      detail: record.description.trim(),
    });
  }

  const logs = Array.isArray(record.activityLogs) ? record.activityLogs : [];
  logs.forEach((log: any) => {
    const parts = formatDateParts(log.snoozedAt);
    if (log.recentDescription?.trim()) {
      events.push({
        sortMs: new Date(log.snoozedAt).getTime(),
        date: parts.date,
        time: parts.time,
        event: 'Note Added',
        detail: log.recentDescription.trim(),
      });
    }
    events.push({
      sortMs: new Date(log.snoozedAt).getTime(),
      date: parts.date,
      time: parts.time,
      event: 'Followup Extended',
      reason: log.extensionReasonName || undefined,
      detail: log.recentDescription?.trim() || undefined,
    });
  });

  if (
    logs.length === 0 &&
    record.previousFollowupDate &&
    record.newFollowupDate &&
    record.snoozedAt
  ) {
    const parts = formatDateParts(record.snoozedAt);
    events.push({
      sortMs: new Date(record.snoozedAt).getTime(),
      date: parts.date,
      time: parts.time,
      event: 'Followup Extended',
      reason: record.extensionReasonName || undefined,
      detail: record.recentDescription?.trim() || undefined,
    });
  }

  if (record.status === 'COMPLETED' && record.completedAt) {
    const parts = formatDateParts(record.completedAt);
    events.push({
      sortMs: new Date(record.completedAt).getTime(),
      date: parts.date,
      time: parts.time,
      event: 'Followup Completed',
      detail: record.completionDescription?.trim() || undefined,
    });
  }

  return events
    .sort((a, b) => a.sortMs - b.sortMs)
    .map(({ sortMs: _sortMs, ...entry }) => entry);
};

const mapFollowUpDetail = (record: any): FollowupDetailReportItem => {
  const notes = mapNotes(record);
  const extensions = mapExtensions(record);
  const createdParts = formatDateParts(record.createdAt);
  const scheduledParts = formatDateParts(record.scheduledAt);

  const detail: FollowupDetailReportItem = {
    id: record.id,
    leadId: record.leadId,
    leadName: record.lead?.name || 'Unknown Lead',
    assignedUser: resolveDisplayName(record.lead?.assignedTo || record.user),
    followupType: String(record.type || 'CALL').replace(/_/g, ' '),
    createdDate: createdParts.date,
    scheduledDate: scheduledParts.date,
    status: String(record.status || 'PENDING'),
    notes,
    extensions,
    timeline: mapTimeline(record),
  };

  if (record.status === 'COMPLETED' && record.completedAt) {
    detail.completion = {
      note: record.completionDescription?.trim() || '',
      completedAt: formatDateParts(record.completedAt).iso,
      completedBy: resolveDisplayName(record.user),
    };
  }

  return detail;
};

export const getFollowupsDetailReport = async (filters: SummaryFilterDto) => {
  const page = Number(filters.page) || 1;
  const limit = Number(filters.limit) || 20;
  const where = await buildFollowUpReportWhere(filters);

  const [total, records] = await Promise.all([
    db.followUp.count({ where }),
    db.followUp.findMany({
      where,
      include: followUpReportInclude,
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: records.map(mapFollowUpDetail),
    pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
};

export type FollowupPerformanceItem = {
  userId: string;
  userName: string;
  assignedFollowups: number;
  completedFollowups: number;
  extendedFollowups: number;
  missedFollowups: number;
  overdueFollowups: number;
  completionRate: number;
};

export const getFollowupsPerformanceReport = async (filters: SummaryFilterDto): Promise<FollowupPerformanceItem[]> => {
  const where = await buildFollowUpReportWhere(filters);

  const records = await db.followUp.findMany({
    where,
    select: {
      id: true,
      userId: true,
      status: true,
      isOverdue: true,
      user: { select: { name: true, username: true, email: true } },
      activityLogs: { select: { id: true }, take: 1 },
      previousFollowupDate: true,
      newFollowupDate: true,
    },
  });

  const byUser = new Map<string, FollowupPerformanceItem>();

  records.forEach((record: any) => {
    const existing =
      byUser.get(record.userId) ||
      ({
        userId: record.userId,
        userName: resolveDisplayName(record.user),
        assignedFollowups: 0,
        completedFollowups: 0,
        extendedFollowups: 0,
        missedFollowups: 0,
        overdueFollowups: 0,
        completionRate: 0,
      } satisfies FollowupPerformanceItem);

    existing.assignedFollowups += 1;
    if (record.status === 'COMPLETED') existing.completedFollowups += 1;
    if (record.status === 'MISSED') existing.missedFollowups += 1;
    if (record.isOverdue && record.status === 'PENDING') existing.overdueFollowups += 1;
    if ((record.activityLogs?.length || 0) > 0 || record.previousFollowupDate || record.newFollowupDate) {
      existing.extendedFollowups += 1;
    }

    existing.completionRate =
      existing.assignedFollowups > 0
        ? Math.round((existing.completedFollowups / existing.assignedFollowups) * 100)
        : 0;

    byUser.set(record.userId, existing);
  });

  return Array.from(byUser.values()).sort((a, b) => b.assignedFollowups - a.assignedFollowups);
};

export type FollowupLatestNoteItem = {
  leadId: string;
  leadName: string;
  latestNote: string;
  latestNoteAt: string;
  addedBy: string;
};

export const getFollowupsLatestNotesReport = async (filters: SummaryFilterDto): Promise<FollowupLatestNoteItem[]> => {
  const where = await buildFollowUpReportWhere(filters);

  const records = await db.followUp.findMany({
    where,
    include: followUpReportInclude,
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
  });

  const latestByLead = new Map<string, FollowupLatestNoteItem>();

  records.forEach((record: any) => {
    const candidates: Array<{ text: string; at: Date; by: string }> = [];

    if (record.description?.trim()) {
      candidates.push({
        text: record.description.trim(),
        at: new Date(record.createdAt),
        by: resolveDisplayName(record.user),
      });
    }

    if (record.completionDescription?.trim() && record.completedAt) {
      candidates.push({
        text: record.completionDescription.trim(),
        at: new Date(record.completedAt),
        by: resolveDisplayName(record.user),
      });
    }

    if (record.recentDescription?.trim()) {
      candidates.push({
        text: record.recentDescription.trim(),
        at: new Date(record.snoozedAt || record.updatedAt),
        by: resolveDisplayName(record.user),
      });
    }

    (record.activityLogs || []).forEach((log: any) => {
      if (!log.recentDescription?.trim()) return;
      candidates.push({
        text: log.recentDescription.trim(),
        at: new Date(log.snoozedAt),
        by: resolveDisplayName(log.snoozedByUser),
      });
    });

    if (candidates.length === 0) return;

    const newest = candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const existing = latestByLead.get(record.leadId);
    if (existing && new Date(existing.latestNoteAt).getTime() >= newest.at.getTime()) return;

    latestByLead.set(record.leadId, {
      leadId: record.leadId,
      leadName: record.lead?.name || 'Unknown Lead',
      latestNote: newest.text,
      latestNoteAt: newest.at.toISOString(),
      addedBy: newest.by,
    });
  });

  return Array.from(latestByLead.values()).sort(
    (a, b) => new Date(b.latestNoteAt).getTime() - new Date(a.latestNoteAt).getTime(),
  );
};
