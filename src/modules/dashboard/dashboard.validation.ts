import { z } from 'zod';

export const dashboardSummaryQuerySchema = z.object({
  range: z.enum(['7d', '30d', '12m']).optional().default('7d'),
});

export type DashboardSummaryQueryInput = z.infer<typeof dashboardSummaryQuerySchema>;
