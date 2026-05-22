import { z } from 'zod';

const periodSchema = z.object({
  label: z.string().trim().min(1),
  periodIndex: z.number().int().min(0),
  targetCount: z.number().int().min(0),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]),
  lockingDate: z.union([z.string(), z.date()]),
});

export const createPerformanceTargetCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    targetType: z.enum(['WEEKLY', 'MONTHLY', 'SEMI_ANNUAL', 'MANUAL']),
    targetMetric: z.enum(['LEADS', 'REVENUE']),
    leadStageId: z.string().uuid().optional().nullable(),
    startDate: z.string(),
    endDate: z.string().optional().nullable(),
    numberOfMonths: z.number().int().min(1).max(36).optional(),
    periodCounts: z.array(z.number().int().min(0)).optional(),
    periods: z.array(periodSchema).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    lockingEnabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.targetMetric === 'LEADS' && !value.leadStageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Lead stage is required for lead-based targets.',
        path: ['leadStageId'],
      });
    }
    if (value.targetType === 'MANUAL' && (!value.periods || value.periods.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one manual period is required.',
        path: ['periods'],
      });
    }
  });

export const assignTargetCycleSchema = z.object({
  targetCycleId: z.string().uuid().nullable(),
});

export const extendGraceSchema = z.object({
  graceUntil: z.string(),
  reason: z.string().trim().max(500).optional(),
});

export const unlockTargetSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
