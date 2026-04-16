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

export const createTargetSchema = z.object({
  targetTypeId: z.string().cuid('Invalid Target Type ID'),
  cycle: z.nativeEnum(TargetCycle).default('MONTHLY'),
  monthlyTargetLeads: z.number().int().min(0).default(0),
  dailyFollowupTarget: z.number().int().min(0).default(0),
  revenueTarget: z.number().min(0).default(0),
  startDate: parseDateField('startDate'),
  endDate: parseOptionalDateField('endDate'),
});

export type CreateTargetInput = z.infer<typeof createTargetSchema>;

export const updateTargetSchema = createTargetSchema.partial();

export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;
