import moment from 'moment-timezone';

export const isFollowUpPastDueDay = (scheduledAt: Date, timeZone: string, now = new Date()): boolean => {
  const scheduledEnd = moment.tz(scheduledAt, timeZone).endOf('day');
  return moment.tz(now, timeZone).isAfter(scheduledEnd);
};

/** Follow-up was snoozed after missing the original scheduled calendar day. */
export const wasExtendedAfterOverdue = (
  followUp: { previousFollowupDate?: Date | null; snoozedAt?: Date | null },
  timeZone: string,
): boolean => {
  if (!followUp.previousFollowupDate || !followUp.snoozedAt) {
    return false;
  }
  const originalDayEnd = moment.tz(followUp.previousFollowupDate, timeZone).endOf('day');
  return moment.tz(followUp.snoozedAt, timeZone).isAfter(originalDayEnd);
};
