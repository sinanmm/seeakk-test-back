import { z } from 'zod';
import { LeadClosureType } from '../../../prisma/generated/client';

export const closedLeadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  assignedTo: z.string().trim().optional(),
  source: z.string().trim().optional(),
  closureType: z.nativeEnum(LeadClosureType).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minRevenue: z.coerce.number().min(0).optional(),
  maxRevenue: z.coerce.number().min(0).optional(),
});

export const updateClosedLeadSchema = z.object({
  generatedRevenue: z.coerce.number().min(0, 'Generated revenue must be 0 or greater.'),
  closureType: z.nativeEnum(LeadClosureType),
});

export const leadIdSchema = z.object({
  id: z.string().cuid(),
});

export type ClosedLeadQueryInput = z.infer<typeof closedLeadQuerySchema>;
export type UpdateClosedLeadInput = z.infer<typeof updateClosedLeadSchema>;
export type ClosedLeadIdInput = z.infer<typeof leadIdSchema>;
