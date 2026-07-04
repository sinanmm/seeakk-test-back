import { eachDayOfInterval, format, getDay, parseISO, startOfDay } from 'date-fns';
import prisma from '../../config/prisma';
import { ensureWeeklyOffSchema } from './weeklyOffSchemaGuard';

export const WEEKDAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

export const DEFAULT_WEEKLY_OFF_DAYS = [0];
export const DEFAULT_WEEKLY_OFF_COLOR = '#cbd5e1';

const createWeeklyOffError = (message: string, statusCode = 400): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

export const normalizeWeeklyOffColor = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    return DEFAULT_WEEKLY_OFF_COLOR;
  }

  const trimmedValue = value.trim();
  const normalizedValue = trimmedValue.startsWith('#') ? trimmedValue : `#${trimmedValue}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalizedValue)) {
    throw createWeeklyOffError('Weekly-off color must be a valid 6-digit hex color.');
  }

  return normalizedValue.toLowerCase();
};

export const normalizeWeeklyOffDays = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    throw createWeeklyOffError('Weekly-off days must be an array.');
  }

  const normalized = [...new Set(value.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort(
    (a, b) => a - b,
  );

  if (!normalized.length) {
    throw createWeeklyOffError('Select at least one weekly-off day.');
  }

  return normalized;
};

export type WorkspaceWeeklyOffSettings = {
  weeklyOffDays: number[];
  weeklyOffColor: string;
};

export const getWorkspaceWeeklyOffSettings = async (workspaceId: string): Promise<WorkspaceWeeklyOffSettings> => {
  await ensureWeeklyOffSchema();
  let workspace: any = null;
  try {
    workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { weeklyOffDays: true, weeklyOffColor: true },
    });
  } catch (error) {
    // Fallback if schema is still inconsistent
    workspace = null;
  }

  if (!workspace) {
    return {
      weeklyOffDays: [...DEFAULT_WEEKLY_OFF_DAYS],
      weeklyOffColor: DEFAULT_WEEKLY_OFF_COLOR,
    };
  }

  const rawDays = Array.isArray(workspace.weeklyOffDays) ? (workspace.weeklyOffDays as any[]) : [];
  const weeklyOffDays = rawDays.length
    ? [...new Set(rawDays)].map(Number).sort((a, b) => a - b)
    : [...DEFAULT_WEEKLY_OFF_DAYS];

  return {
    weeklyOffDays,
    weeklyOffColor: normalizeWeeklyOffColor(workspace.weeklyOffColor),
  };
};

export const updateWorkspaceWeeklyOffSettings = async (
  workspaceId: string,
  payload: { weeklyOffDays: number[]; weeklyOffColor: string },
) => {
  await ensureWeeklyOffSchema();
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      weeklyOffDays: payload.weeklyOffDays as any,
      weeklyOffColor: payload.weeklyOffColor,
    },
    select: { weeklyOffDays: true, weeklyOffColor: true },
  });
};

export const isWeeklyOffDate = (date: Date, weeklyOffDays: number[]): boolean => weeklyOffDays.includes(getDay(date));

export const isWeeklyOffDateString = (dateStr: string, weeklyOffDays: number[]): boolean => {
  const parsed = parseISO(dateStr);
  if (Number.isNaN(parsed.getTime())) return false;
  return isWeeklyOffDate(parsed, weeklyOffDays);
};

export const isHolidayOnDate = (holidays: any[], dateStr: string): boolean => {
  const [, m, d] = dateStr.split('-');
  return holidays.some((holiday) => {
    const hdStr =
      typeof holiday.holidayDate === 'string'
        ? holiday.holidayDate.split('T')[0]
        : new Date(holiday.holidayDate).toISOString().split('T')[0];
    const [, hm, hd] = hdStr.split('-');
    if (holiday.isRecurring) {
      return hm === m && hd === d;
    }
    return dateStr === hdStr;
  });
};

export const appendWeeklyOffCalendarItems = (
  month: string | undefined,
  weeklyOffDays: number[],
  weeklyOffColor: string,
): Array<{ date: string; color: string; title: string; type: string; source: string }> => {
  if (!month) return [];

  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return [];

  const monthStart = new Date(year, monthNumber - 1, 1);
  const monthEnd = new Date(year, monthNumber, 0);
  const items: Array<{ date: string; color: string; title: string; type: string; source: string }> = [];

  eachDayOfInterval({ start: monthStart, end: monthEnd }).forEach((day) => {
    if (!isWeeklyOffDate(day, weeklyOffDays)) return;
    items.push({
      date: format(day, 'yyyy-MM-dd'),
      color: weeklyOffColor,
      title: 'Weekly Off',
      type: 'WEEKLY_OFF',
      source: 'SYSTEM',
    });
  });

  return items;
};

export const countWorkingDaysInRange = (
  start: Date,
  end: Date,
  holidays: any[],
  weeklyOffDays: number[],
): number => {
  const days = eachDayOfInterval({ start: startOfDay(start), end: startOfDay(end) });
  return days.filter((day) => {
    const formatted = format(day, 'yyyy-MM-dd');
    return !isHolidayOnDate(holidays, formatted) && !isWeeklyOffDate(day, weeklyOffDays);
  }).length;
};

export const assertSchedulableBusinessDate = (
  scheduledAt: string | Date,
  weeklyOffDays: number[],
  holidays: any[],
): void => {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) {
    throw createWeeklyOffError('Scheduled date is invalid.');
  }

  const dateStr = format(date, 'yyyy-MM-dd');
  if (isWeeklyOffDate(date, weeklyOffDays)) {
    throw createWeeklyOffError('Follow-ups cannot be scheduled on a weekly-off day.', 422);
  }

  if (isHolidayOnDate(holidays, dateStr)) {
    throw createWeeklyOffError('Follow-ups cannot be scheduled on a holiday.', 422);
  }
};
