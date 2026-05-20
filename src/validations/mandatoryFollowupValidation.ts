import { z } from 'zod';

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

export const saveMandatoryFollowUpContinuationSchema = z.object({
  leadId: z.string().trim().min(1, 'leadId is required').max(191),
  scheduledAt: parseDateField('scheduledAt'),
  type: z.enum(['CALL', 'VISIT', 'MEETING']),
  description: z.string().trim().max(2000).optional(),
});

export type SaveMandatoryFollowUpContinuationInput = z.infer<typeof saveMandatoryFollowUpContinuationSchema>;
