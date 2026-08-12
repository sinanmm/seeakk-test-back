import { z } from 'zod';

export const saveFormConfigSchema = z.object({
  enabled: z.boolean(),
  defaultLeadStageId: z.string().optional().nullable(),
  leadSourceId: z.string().optional().nullable(),
  assignmentType: z.enum(['UNASSIGNED', 'SPECIFIC_USER', 'ROUND_ROBIN']),
  assignmentUserId: z.string().optional().nullable(),
  roundRobinUserIds: z.array(z.string()).optional(),
  fieldMappings: z.array(
    z.object({
      metaFieldName: z.string(),
      metaFieldLabel: z.string().optional(),
      seeakkFieldKey: z.string(),
    }),
  ),
});

export type SaveFormConfigInput = z.infer<typeof saveFormConfigSchema>;
