import { z } from 'zod';

export const initiateCallSchema = z.object({
  sourceContext: z.enum(['ALL_LEADS', 'LEAD_DETAILS', 'FOLLOW_UP_POPUP']).default('ALL_LEADS'),
  followUpId: z.string().optional(),
});

export const saveCallOutcomeSchema = z.object({
  callSessionId: z.string().min(1, 'Call Session ID required'),
  connectionStatus: z.enum(['CONNECTED', 'NOT_CONNECTED']),
  substageId: z.string().nullable().optional(),
  targetStageId: z.string().nullable().optional(),
  outcomeNotes: z.string().trim().max(2000).optional(),
  callPriority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  followUpRequired: z.boolean().default(false),
  nextFollowUpDate: z.string().optional(), // YYYY-MM-DD or ISO string
  nextFollowUpTime: z.string().optional(), // HH:mm or ISO string
  followUpType: z.string().default('CALL'),
  followUpDescription: z.string().trim().max(1000).optional(),
  stageRuleValues: z
    .array(
      z.object({
        ruleId: z.string(),
        value: z.string(),
      }),
    )
    .optional(),
  reasonId: z.string().optional(), // For LOB if selected
  lobReasonId: z.string().optional(), // Alias for reasonId
  lobRemarks: z.string().optional(),
});

export type InitiateCallInput = z.infer<typeof initiateCallSchema>;
export type SaveCallOutcomeInput = z.infer<typeof saveCallOutcomeSchema>;
