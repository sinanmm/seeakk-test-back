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

export const createAutomationSchema = z.object({
  name: z.string().trim().min(1, 'Automation name is required'),
  metaConnectionId: z.string().optional().nullable(),
  metaPageConnectionId: z.string().min(1, 'Facebook page is required'),
  metaFormId: z.string().min(1, 'Lead form is required'),
  formName: z.string().optional(),
  enabled: z.boolean().default(true),
  defaultLeadStageId: z.string().optional().nullable(),
  leadSourceId: z.string().optional().nullable(),
  assignmentType: z.enum(['UNASSIGNED', 'SPECIFIC_USER', 'ROUND_ROBIN']).default('UNASSIGNED'),
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

export const updateAutomationSchema = createAutomationSchema.partial();

export const toggleAutomationSchema = z.object({
  enabled: z.boolean(),
});

export type SaveFormConfigInput = z.infer<typeof saveFormConfigSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
export type ToggleAutomationInput = z.infer<typeof toggleAutomationSchema>;
