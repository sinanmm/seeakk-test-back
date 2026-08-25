import moment from 'moment-timezone';
import prisma from '../config/prisma';

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Resolve the applicable IANA timezone string for a given workspace/user context.
 * Hierarchy: User Timezone -> Workspace Timezone -> Default ('Asia/Kolkata')
 */
export const resolveWorkspaceTimezone = async (
  workspaceId: string,
  userId?: string,
): Promise<string> => {
  try {
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { timeZone: true } as any,
      });
      if (user && (user as any).timeZone && moment.tz.zone((user as any).timeZone)) {
        return (user as any).timeZone;
      }
    }

    if (workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { timeZone: true },
      });

      if (workspace?.timeZone && moment.tz.zone(workspace.timeZone)) {
        return workspace.timeZone;
      }
    }
  } catch {
    // fallback on error
  }

  return DEFAULT_TIMEZONE;
};

/**
 * Format a Date or ISO string to 12-hour time (hh:mm AM/PM) in the specified target timezone.
 */
export const formatTimeInTimezone = (
  dateInput?: Date | string | null,
  timeZone = DEFAULT_TIMEZONE,
): string | null => {
  if (!dateInput) return null;
  const m = moment(dateInput).tz(timeZone);
  if (!m.isValid()) return null;
  return m.format('hh:mm A');
};

/**
 * Extract YYYY-MM-DD date string for a timestamp in the target timezone.
 */
export const formatDateInTimezone = (
  dateInput?: Date | string | null,
  timeZone = DEFAULT_TIMEZONE,
): string => {
  const m = dateInput ? moment(dateInput).tz(timeZone) : moment().tz(timeZone);
  if (!m.isValid()) return moment().tz(timeZone).format('YYYY-MM-DD');
  return m.format('YYYY-MM-DD');
};

/**
 * Format a Date or ISO string to full datetime string in the specified target timezone.
 */
export const formatDateTimeInTimezone = (
  dateInput?: Date | string | null,
  timeZone = DEFAULT_TIMEZONE,
): string | null => {
  if (!dateInput) return null;
  const m = moment(dateInput).tz(timeZone);
  if (!m.isValid()) return null;
  return m.format('DD/MM/YYYY, hh:mm:ss A');
};

/**
 * Convert a Date / ISO timestamp to total minutes from start of day in target timezone.
 */
export const dateToMinutesInTimezone = (
  dateInput?: Date | string | null,
  timeZone = DEFAULT_TIMEZONE,
): number | null => {
  if (!dateInput) return null;
  const m = moment(dateInput).tz(timeZone);
  if (!m.isValid()) return null;
  return m.hours() * 60 + m.minutes();
};
