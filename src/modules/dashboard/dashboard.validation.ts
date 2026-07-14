import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional();

export const dashboardSummaryQuerySchema = z.object({
  range: z.enum(['7d', '30d', '12m']).optional().default('7d'),
  officeId: optionalString,
  userId: optionalString,
  stageId: optionalString,
  sourceId: optionalString,
  status: z.preprocess(
    emptyStringToUndefined,
    z.enum(['ACTIVE', 'OPEN', 'CLOSED', 'LOB', 'ARCHIVED']).optional(),
  ).optional(),
  dateFrom: optionalString,
  dateTo: optionalString,
});

export type DashboardSummaryQueryInput = z.infer<typeof dashboardSummaryQuerySchema>;

export const revenueAnalyticsQuerySchema = z.object({
  dateFrom: optionalString,
  dateTo: optionalString,
  userId: optionalString,
  stageId: optionalString,
  sourceId: optionalString,
  status: z.preprocess(
    emptyStringToUndefined,
    z.enum(['ACTIVE', 'OPEN', 'CLOSED', 'LOB', 'ARCHIVED']).optional(),
  ).optional(),
  supervisorId: optionalString,
  officeId: optionalString,
});

export type RevenueAnalyticsQueryInput = z.infer<typeof revenueAnalyticsQuerySchema>;
