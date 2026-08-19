import { z } from 'zod';

export const triggerConfigSchema = z.object({
  stageId: z.string().optional(),
});

export const conditionRuleSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.any().optional(),
});

export const conditionGroupSchema = z.object({
  rules: z.array(conditionRuleSchema),
});

export const actionSchema = z.object({
  id: z.string().optional(),
  actionType: z.string(),
  actionConfig: z.record(z.string(), z.any()),
  delaySeconds: z.number().default(0),
  runIfConfig: z.string().nullable().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  triggerType: z.string(),
  triggerConfig: z.record(z.string(), z.any()).default({}),
  conditionConfig: z.array(conditionGroupSchema).default([]),
  active: z.boolean().default(false),
  actions: z.array(actionSchema).min(1, 'At least one action is required'),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();
