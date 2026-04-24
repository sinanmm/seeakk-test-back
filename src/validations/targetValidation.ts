import { z } from 'zod';

export const TargetCycle = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
  CUSTOM: 'CUSTOM',
} as const;

const parseDateField = (label: string) =>
  z.preprocess((value) => {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return value;
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
  }, z.date({ message: `${label} must be a valid date` }));

const parseOptionalDateField = (label: string) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const parsed = new Date(value.trim());
      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }
    return value;
  }, z.date({ message: `${label} must be a valid date` }).optional());

const parseNonNegativeIntField = (label: string, fallback = 0) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number({ message: `${label} must be a valid number` }).int(`${label} must be a whole number`).min(0, `${label} cannot be negative`));

const parseNonNegativeFloatField = (label: string, fallback = 0) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return fallback;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number({ message: `${label} must be a valid number` }).min(0, `${label} cannot be negative`));

const parseCycleField = () =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase();
    return normalized || value;
  }, z.nativeEnum(TargetCycle).default('MONTHLY'));

export const createTargetSchema = z.object({
  targetTypeId: z.string().cuid('Invalid Target Type ID'),
  cycle: parseCycleField(),
  monthlyTargetLeads: parseNonNegativeIntField('monthlyTargetLeads', 0),
  dailyFollowupTarget: parseNonNegativeIntField('dailyFollowupTarget', 0),
  revenueTarget: parseNonNegativeFloatField('revenueTarget', 0),
  startDate: parseDateField('startDate'),
  endDate: parseOptionalDateField('endDate'),
});

export type CreateTargetInput = z.infer<typeof createTargetSchema>;

export const updateTargetSchema = createTargetSchema.partial();

export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;
