import { z } from 'zod';

export const CLOSURE_TYPE_VALUES = ['WON', 'LOST', 'CANCELLED'] as const;

export const closedLeadQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  assignedTo: z.string().trim().optional(),
  source: z.string().trim().optional(),
  closureType: z.enum(CLOSURE_TYPE_VALUES).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minRevenue: z.coerce.number().min(0).optional(),
  maxRevenue: z.coerce.number().min(0).optional(),
});

export const updateClosedLeadSchema = z
  .object({
    generatedRevenue: z.coerce
      .number({ message: 'Revenue must be a valid number.' })
      .finite('Revenue must be a valid number.'),
    closureType: z.enum(CLOSURE_TYPE_VALUES, { message: 'Invalid closure type.' }),
  })
  .superRefine((data, ctx) => {
    if (data.generatedRevenue < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['generatedRevenue'],
        message: 'Revenue cannot be negative.',
      });
    }

    if (data.closureType === 'WON' && data.generatedRevenue <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['generatedRevenue'],
        message: 'Revenue must be greater than zero for won closures.',
      });
    }
  });

export const leadIdSchema = z.object({
  id: z.string().trim().min(1, 'Lead id is required.').max(191, 'Invalid lead id.'),
});

export type ClosedLeadQueryInput = z.infer<typeof closedLeadQuerySchema>;
export type UpdateClosedLeadInput = z.infer<typeof updateClosedLeadSchema>;
export type ClosedLeadIdInput = z.infer<typeof leadIdSchema>;
