import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
} from 'date-fns';

export type PeriodInput = {
  label: string;
  periodIndex: number;
  targetCount: number;
  startDate: Date;
  endDate: Date;
  lockingDate: Date;
};

export type BuildPeriodsInput = {
  targetType: 'WEEKLY' | 'MONTHLY' | 'SEMI_ANNUAL' | 'MANUAL';
  startDate: Date;
  endDate?: Date | null;
  numberOfMonths?: number | null;
  periods?: Array<{
    label: string;
    periodIndex: number;
    targetCount: number;
    startDate: string | Date;
    endDate: string | Date;
    lockingDate: string | Date;
  }>;
  /** For WEEKLY/MONTHLY: counts keyed by generated period index */
  periodCounts?: number[];
};

const toEndOfDay = (date: Date) => endOfDay(date);

const buildWeeklyPeriodsForMonth = (
  monthStart: Date,
  weekCounts: number[],
  startIndex: number,
): PeriodInput[] => {
  const monthEnd = endOfMonth(monthStart);
  const periods: PeriodInput[] = [];
  let cursor = startOfDay(monthStart);
  let weekNum = 0;

  while (cursor <= monthEnd && weekNum < 6) {
    const weekEnd = toEndOfDay(addDays(cursor, 6));
    const cappedEnd = weekEnd > monthEnd ? toEndOfDay(monthEnd) : weekEnd;
    periods.push({
      label: `${format(monthStart, 'MMM yyyy')} · Week ${weekNum + 1}`,
      periodIndex: startIndex + periods.length,
      targetCount: weekCounts[weekNum] ?? weekCounts[weekCounts.length - 1] ?? 0,
      startDate: cursor,
      endDate: cappedEnd,
      lockingDate: cappedEnd,
    });
    cursor = startOfDay(addDays(cappedEnd, 1));
    weekNum += 1;
    if (cursor > monthEnd) break;
  }

  return periods;
};

export const buildTargetCyclePeriods = (input: BuildPeriodsInput): PeriodInput[] => {
  if (input.targetType === 'MANUAL') {
    if (!input.periods?.length) {
      throw Object.assign(new Error('At least one manual period is required.'), { statusCode: 422 });
    }
    return input.periods.map((period, index) => ({
      ...period,
      periodIndex: index,
      startDate: startOfDay(new Date(period.startDate)),
      endDate: toEndOfDay(new Date(period.endDate)),
      lockingDate: toEndOfDay(new Date(period.lockingDate)),
    }));
  }

  const start = startOfDay(new Date(input.startDate));
  const counts = input.periodCounts || [];

  if (input.targetType === 'SEMI_ANNUAL') {
    const periods: PeriodInput[] = [];
    for (let i = 0; i < 6; i += 1) {
      const monthStart = startOfMonth(addMonths(start, i));
      const monthEnd = toEndOfDay(endOfMonth(monthStart));
      periods.push({
        label: format(monthStart, 'MMMM yyyy'),
        periodIndex: i,
        targetCount: counts[i] ?? 0,
        startDate: monthStart,
        endDate: monthEnd,
        lockingDate: monthEnd,
      });
    }
    return periods;
  }

  const months =
    input.numberOfMonths && input.numberOfMonths > 0
      ? input.numberOfMonths
      : input.endDate
        ? Math.max(
            1,
            (new Date(input.endDate).getFullYear() - start.getFullYear()) * 12 +
              (new Date(input.endDate).getMonth() - start.getMonth()) +
              1,
          )
        : 12;

  if (input.targetType === 'MONTHLY') {
    const periods: PeriodInput[] = [];
    for (let i = 0; i < months; i += 1) {
      const monthStart = startOfMonth(addMonths(start, i));
      const monthEnd = toEndOfDay(endOfMonth(monthStart));
      periods.push({
        label: format(monthStart, 'MMMM yyyy'),
        periodIndex: i,
        targetCount: counts[i] ?? 0,
        startDate: monthStart,
        endDate: monthEnd,
        lockingDate: monthEnd,
      });
    }
    return periods;
  }

  // WEEKLY — per month, split into weeks
  const periods: PeriodInput[] = [];
  let globalIndex = 0;
  for (let i = 0; i < months; i += 1) {
    const monthStart = startOfMonth(addMonths(start, i));
    const weeksInMonth = 4;
    const monthCounts = counts.slice(i * weeksInMonth, i * weeksInMonth + weeksInMonth);
    const monthPeriods = buildWeeklyPeriodsForMonth(monthStart, monthCounts, globalIndex);
    periods.push(...monthPeriods);
    globalIndex += monthPeriods.length;
  }
  return periods;
};
