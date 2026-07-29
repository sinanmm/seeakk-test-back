import { z } from 'zod';

const productTargetSchema = z.object({
  productId: z.string().trim().min(1),
  targetValue: z.number().int().min(0),
});

const periodMetricSchema = z.object({
  metricType: z.enum(['LEADS', 'REVENUE', 'FOLLOW_UP', 'PRODUCTS']),
  targetValue: z.number().min(0),
  stageTargets: z.array(z.object({
    leadStageId: z.string().trim().min(1),
    targetValue: z.number().int().min(0),
  })).optional().nullable(),
  productTargets: z.array(productTargetSchema).optional().nullable(),
});

const periodSchema = z.object({
  label: z.string().trim().min(1),
  periodIndex: z.number().int().min(0),
  targetCount: z.number().int().min(0).optional(),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]),
  lockingDate: z.union([z.string(), z.date()]),
  metrics: z.array(periodMetricSchema).optional().nullable(),
});

export const createPerformanceTargetCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    targetType: z.enum(['WEEKLY', 'MONTHLY', 'SEMI_ANNUAL', 'MANUAL']),
    targetMetric: z.enum(['LEADS', 'REVENUE', 'FOLLOW_UP', 'PRODUCTS']).optional().nullable(),
    leadStageId: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .optional()
      .nullable(),
    startDate: z.string(),
    endDate: z.string().optional().nullable(),
    numberOfMonths: z.number().int().min(1).max(36).optional(),
    periodCounts: z.array(z.number().int().min(0)).optional(),
    periods: z.array(periodSchema).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
    lockingEnabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // If targetMetric is specified without period metrics, validate leadStageId
    if (value.targetMetric === 'LEADS' && !value.leadStageId && (!value.periods || !value.periods.some(p => p.metrics && p.metrics.length > 0))) {
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

const optionalResourceId = z.preprocess(
  (value) => (typeof value === 'string' && !value.trim() ? null : value),
  z
    .string()
    .trim()
    .min(1, 'Invalid target cycle ID')
    .max(191, 'Invalid target cycle ID')
    .nullable(),
);

export const assignTargetCycleSchema = z.object({
  targetCycleId: optionalResourceId,
});

export const extendGraceSchema = z.object({
  graceUntil: z.string(),
  reason: z.string().trim().max(500).optional(),
});

export const unlockTargetSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
