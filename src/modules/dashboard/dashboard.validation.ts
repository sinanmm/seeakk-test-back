import { z } from 'zod';

export const dashboardSummaryQuerySchema = z.object({
  range: z.enum(['7d', '30d', '12m']).optional().default('7d'),
});

export type DashboardSummaryQueryInput = z.infer<typeof dashboardSummaryQuerySchema>;

export const revenueAnalyticsQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  userId: z.string().optional(),
  stageId: z.string().optional(),
  supervisorId: z.string().optional(),
});

export type RevenueAnalyticsQueryInput = z.infer<typeof revenueAnalyticsQuerySchema>;
