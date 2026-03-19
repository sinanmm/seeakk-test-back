import { z } from 'zod';

export const TargetCycle = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
  CUSTOM: 'CUSTOM',
} as const;

export const createTargetSchema = z.object({
  targetTypeId: z.string().cuid('Invalid Target Type ID'),
  cycle: z.nativeEnum(TargetCycle).default('MONTHLY'),
  monthlyTargetLeads: z.number().int().min(0).default(0),
  dailyFollowupTarget: z.number().int().min(0).default(0),
  revenueTarget: z.number().min(0).default(0),
  startDate: z.string().datetime().or(z.date()).transform((v) => new Date(v)),
  endDate: z.string().datetime().or(z.date()).optional().transform((v) => v ? new Date(v) : undefined),
});

export type CreateTargetInput = z.infer<typeof createTargetSchema>;

export const updateTargetSchema = createTargetSchema.partial();

export type UpdateTargetInput = z.infer<typeof updateTargetSchema>;
