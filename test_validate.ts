import { startOfDay, endOfDay } from 'date-fns';

const validateManualPeriods = (periods: any[]): void => {
  const sorted = [...periods].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  for (let i = 0; i < sorted.length; i += 1) {
    const period = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      if (!isBefore(prev.endDate, period.startDate) && prev.endDate.getTime() !== period.startDate.getTime()) {
        throw new Error('Manual periods cannot overlap.');
      }
    }
  }
};

const isBefore = (a: Date, b: Date) => a.getTime() < b.getTime();

const periods = [
  { startDate: startOfDay(new Date('2026-06-26')), endDate: endOfDay(new Date('2026-07-03')) },
  { startDate: startOfDay(new Date('2026-07-04')), endDate: endOfDay(new Date('2026-07-10')) }
];

try {
  validateManualPeriods(periods);
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR:", e.message);
}
