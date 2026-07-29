import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  format,
  isBefore,
  max as maxDate,
  min as minDate,
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
  metrics?: Array<{
    metricType: 'LEADS' | 'REVENUE' | 'FOLLOW_UP' | 'PRODUCTS';
    targetValue: number;
    stageTargets?: Array<{ leadStageId: string; targetValue: number }> | null;
    productTargets?: Array<{ productId: string; targetValue: number }> | null;
  }> | null;
};

export type BuildPeriodsInput = {
  targetType: 'WEEKLY' | 'MONTHLY' | 'SEMI_ANNUAL' | 'MANUAL';
  startDate: Date;
  endDate?: Date | null;
  numberOfMonths?: number | null;
  periods?: Array<{
    label: string;
    periodIndex: number;
    targetCount?: number;
    startDate: string | Date;
    endDate: string | Date;
    lockingDate: string | Date;
    metrics?: Array<{
      metricType: 'LEADS' | 'REVENUE' | 'FOLLOW_UP' | 'PRODUCTS';
      targetValue: number;
      stageTargets?: Array<{ leadStageId: string; targetValue: number }> | null;
      productTargets?: Array<{ productId: string; targetValue: number }> | null;
    }> | null;
  }>;
  /** Counts keyed by generated period index (same order as buildTargetCyclePeriods output). */
  periodCounts?: number[];
};

const toEndOfDay = (date: Date) => endOfDay(date);

/** Inclusive calendar days between two dates. */
export const inclusiveCalendarDays = (start: Date, end: Date): number => {
  const s = startOfDay(start);
  const e = startOfDay(end);
  if (isBefore(e, s)) return 0;
  return differenceInCalendarDays(e, s) + 1;
};

/** Total active days across non-overlapping periods (sum of each period span). */
export const computeTotalDaysFromPeriods = (periods: PeriodInput[]): number => {
  if (!periods.length) return 0;
  return periods.reduce((sum, period) => sum + inclusiveCalendarDays(period.startDate, period.endDate), 0);
};

export const resolveMonthCount = (input: BuildPeriodsInput, start: Date): number => {
  if (input.numberOfMonths && input.numberOfMonths > 0) {
    return input.numberOfMonths;
  }
  if (input.endDate) {
    const end = startOfDay(new Date(input.endDate));
    return Math.max(
      1,
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1,
    );
  }
  if (input.targetType === 'SEMI_ANNUAL') return 6;
  return 12;
};

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

/** Preview how many weekly periods a month produces (4–6 depending on calendar). */
export const countWeeksInMonth = (monthStart: Date): number =>
  buildWeeklyPeriodsForMonth(monthStart, [], 0).length;

/** How many target count inputs the UI should render before save. */
export const countPeriodSlots = (input: {
  targetType: BuildPeriodsInput['targetType'];
  startDate: Date;
  numberOfMonths?: number | null;
  endDate?: Date | null;
}): number => {
  const start = startOfDay(new Date(input.startDate));
  const months = resolveMonthCount(
    { targetType: input.targetType, startDate: start, numberOfMonths: input.numberOfMonths, endDate: input.endDate },
    start,
  );

  if (input.targetType === 'SEMI_ANNUAL') return 6;
  if (input.targetType === 'MONTHLY') return months;
  if (input.targetType === 'WEEKLY') {
    let slots = 0;
    for (let i = 0; i < months; i += 1) {
      slots += countWeeksInMonth(startOfMonth(addMonths(start, i)));
    }
    return slots;
  }
  return 0;
};

const validateManualPeriods = (periods: PeriodInput[]): void => {
  const sorted = [...periods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (let i = 0; i < sorted.length; i += 1) {
    const period = sorted[i];
    if (isBefore(period.endDate, period.startDate)) {
      throw Object.assign(new Error('Manual period end date must be on or after the start date.'), {
        statusCode: 422,
      });
    }
    if (isBefore(period.lockingDate, period.startDate)) {
      throw Object.assign(new Error('Manual period locking date must be on or after the start date.'), {
        statusCode: 422,
      });
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (!isBefore(prev.endDate, period.startDate) && prev.endDate.getTime() !== period.startDate.getTime()) {
        throw Object.assign(new Error('Manual periods cannot overlap.'), { statusCode: 422 });
      }
    }
  }
};

export const buildTargetCyclePeriods = (input: BuildPeriodsInput): PeriodInput[] => {
  // If periods are explicitly provided (e.g. from the multi-metric UI configuration), preserve and return them
  if (input.periods && input.periods.length > 0) {
    const mapped = input.periods.map((period, index) => ({
      label: period.label?.trim() || `Period ${index + 1}`,
      periodIndex: period.periodIndex ?? index,
      targetCount: period.targetCount ?? 0,
      startDate: startOfDay(new Date(period.startDate)),
      endDate: toEndOfDay(new Date(period.endDate)),
      lockingDate: toEndOfDay(new Date(period.lockingDate)),
      metrics: period.metrics ?? null,
    }));
    if (input.targetType === 'MANUAL') {
      validateManualPeriods(mapped);
    }
    return mapped;
  }

  if (input.targetType === 'MANUAL') {
    throw Object.assign(new Error('At least one manual period is required.'), { statusCode: 422 });
  }

  const start = startOfDay(new Date(input.startDate));
  const counts = input.periodCounts || [];
  const months = resolveMonthCount(input, start);

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

  // WEEKLY — calendar weeks per month (4–6 depending on month length / start weekday)
  const periods: PeriodInput[] = [];
  let globalIndex = 0;
  let countOffset = 0;

  for (let i = 0; i < months; i += 1) {
    const monthStart = startOfMonth(addMonths(start, i));
    const weeksInMonth = countWeeksInMonth(monthStart);
    const monthCounts = counts.slice(countOffset, countOffset + weeksInMonth);
    const monthPeriods = buildWeeklyPeriodsForMonth(monthStart, monthCounts, globalIndex);
    periods.push(...monthPeriods);
    globalIndex += monthPeriods.length;
    countOffset += weeksInMonth;
  }

  return periods;
};

/** Map stored DB periods back to periodCounts aligned with a rebuild. */
export const derivePeriodCountsFromPeriods = (
  targetType: BuildPeriodsInput['targetType'],
  startDate: Date,
  numberOfMonths: number | null | undefined,
  stored: Array<{ periodIndex: number; targetCount: number }>,
): number[] => {
  const slots = countPeriodSlots({ targetType, startDate, numberOfMonths });
  const byIndex = new Map(stored.map((p) => [p.periodIndex, p.targetCount]));
  return Array.from({ length: slots }, (_, i) => byIndex.get(i) ?? 0);
};

export const computeCycleDateBounds = (
  periods: PeriodInput[],
): { startDate: Date; endDate: Date | null } => {
  if (!periods.length) {
    return { startDate: startOfDay(new Date()), endDate: null };
  }
  const starts = periods.map((p) => p.startDate);
  const ends = periods.map((p) => p.endDate);
  return {
    startDate: minDate(starts),
    endDate: maxDate(ends),
  };
};
