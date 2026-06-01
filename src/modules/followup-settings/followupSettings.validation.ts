import { z } from 'zod';

export const updateFollowUpSettingsSchema = z.object({
  dailyLimitEnabled: z.boolean().optional(),
  dailyLimitCount: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  capacityValidationEnabled: z.boolean().optional(),
  bulkExtensionEnabled: z.boolean().optional(),
  autoDistributionEnabled: z.boolean().optional(),
  defaultBulkExtensionDuration: z.string().optional(),
  maxBulkExtensionCount: z.number().int().min(1).optional(),
});

export type UpdateFollowUpSettingsInput = z.infer<typeof updateFollowUpSettingsSchema>;

export const grantTemporaryAccessSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  duration: z.enum(['1 Day', '3 Days', '7 Days', 'Custom'], {
    message: 'Duration must be 1 Day, 3 Days, 7 Days, or Custom',
  }),
  customExpiryDate: z.string().optional().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    return !isNaN(date.getTime()) && date.getTime() > Date.now();
  }, {
    message: 'Custom expiry date must be a valid future date',
  }),
});

export type GrantTemporaryAccessInput = z.infer<typeof grantTemporaryAccessSchema>;
