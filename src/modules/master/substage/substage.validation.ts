import { z } from 'zod';

export const createSubstageSchema = z.object({
  leadStageId: z.string().min(1, 'Main lead stage required'),
  name: z.string().trim().min(1, 'Substage name required').max(100),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
  connectionStatusRestriction: z.enum(['CONNECTED', 'NOT_CONNECTED']).nullable().optional(),
  outcomeCategory: z.enum(['POSITIVE', 'FOLLOW_UP', 'NEGATIVE', 'NEUTRAL']).nullable().optional(),
});

export const updateSubstageSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
  connectionStatusRestriction: z.enum(['CONNECTED', 'NOT_CONNECTED']).nullable().optional(),
  outcomeCategory: z.enum(['POSITIVE', 'FOLLOW_UP', 'NEGATIVE', 'NEUTRAL']).nullable().optional(),
});

export type CreateSubstageInput = z.infer<typeof createSubstageSchema>;
export type UpdateSubstageInput = z.infer<typeof updateSubstageSchema>;
