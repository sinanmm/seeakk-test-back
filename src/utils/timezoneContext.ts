import moment from 'moment-timezone';
import prisma from '../config/prisma';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Identify if a timezone name or workspace configuration represents India Standard Time
 */
export const isIndianTimezoneOrWorkspace = (
  timeZone?: string | null,
  currencyLocale?: string | null,
): boolean => {
  if (!timeZone || !timeZone.trim()) return currencyLocale === 'INR';
  const tz = timeZone.trim();
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return true;
  // Indian ocean island territories mistakenly selected in place of India Standard Time
  if (
    tz === 'Indian/Chagos' ||
    tz === 'Indian/Christmas' ||
    tz === 'Indian/Mahe' ||
    tz === 'Indian/Cocos' ||
    tz === 'Indian/Kerguelen'
  ) {
    return true;
  }
  if (currencyLocale === 'INR' && (tz === 'UTC' || tz.startsWith('Indian/'))) {
    return true;
  }
  return false;
};

/**
 * Normalize an IANA timezone identifier with Indian workspace and regional fallback rules.
 */
export const normalizeTimezone = (
  timeZone?: string | null,
  currencyLocale?: string | null,
): string => {
  if (isIndianTimezoneOrWorkspace(timeZone, currencyLocale)) {
    return 'Asia/Kolkata';
  }
  if (timeZone && timeZone.trim() && moment.tz.zone(timeZone.trim())) {
    return timeZone.trim();
  }
  if (currencyLocale === 'AED') return 'Asia/Dubai';
  if (currencyLocale === 'QAR') return 'Asia/Qatar';
  return DEFAULT_TIMEZONE;
};

/**
 * Resolve the applicable IANA timezone string for a given workspace/user context.
 * Hierarchy: Workspace Timezone (normalized) -> Default ('Asia/Kolkata')
 */
export const resolveWorkspaceTimezone = async (
  workspaceId: string,
  userId?: string,
): Promise<string> => {
  try {
    if (workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { timeZone: true, currencyLocale: true },
      });

      if (workspace) {
        return normalizeTimezone(workspace.timeZone, workspace.currencyLocale);
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
