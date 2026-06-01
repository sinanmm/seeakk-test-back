import { z } from 'zod';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const requiredId = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(191, `Invalid ${label}`);

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

const parseOptionalDateField = (label: string) =>
  z.preprocess((value: unknown) => {
    const normalized = emptyStringToUndefined(value);
    if (normalized === undefined) return undefined;
    if (normalized instanceof Date) return normalized;
    if (typeof normalized === 'string') {
      const parsed = new Date(normalized);
      return Number.isNaN(parsed.getTime()) ? normalized : parsed;
    }
    return normalized;
  }, z.date({ message: `${label} must be a valid date` }).optional());

const positiveIntString = (label: string, defaultValue: number, max = 100) =>
  z
    .string()
    .optional()
    .transform((value: string | undefined) => {
      if (!value) return defaultValue;
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) return defaultValue;
      return Math.min(max, Math.max(1, parsed));
    });

const followUpTypeSchema = z.enum(['CALL', 'VISIT', 'MEETING']);
const followUpStatusSchema = z.enum(['PENDING', 'COMPLETED', 'MISSED']);
const calendarViewSchema = z.enum(['month', 'week', 'day', 'list']);

export const createFollowUpSchema = z.object({
  leadId: requiredId('leadId'),
  type: followUpTypeSchema,
  scheduledAt: parseDateField('scheduledAt'),
  description: z.preprocess(emptyStringToUndefined, z.string().trim().max(1000).optional()).optional(),
});

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const completeFollowUpSchema = z.object({
  description: z.string().trim().min(1, 'description is required').max(2000, 'description is too long'),
  images: z.array(z.string().trim().url('Each image must be a valid URL')).max(10, 'A maximum of 10 images is allowed').optional().default([]),
});

export type CompleteFollowUpInput = z.infer<typeof completeFollowUpSchema>;

export const snoozeFollowUpSchema = z
  .object({
    scheduledAt: parseDateField('scheduledAt'),
    recentDescription: z.string().trim().max(3000, 'Description is too long').optional().nullable(),
    extensionReasonId: z.string().trim().max(191, 'Invalid extension reason id').optional().nullable(),
    reminderActionType: z.enum(['SNOOZE', 'REMIND_LATER']),
  })
  .refine(
    (data) => {
      const hasDescription = typeof data.recentDescription === 'string' && data.recentDescription.trim().length > 0;
      const hasReason = typeof data.extensionReasonId === 'string' && data.extensionReasonId.trim().length > 0;
      return hasDescription || hasReason;
    },
    {
      message: 'Either a Predefined Reason or a Custom Description is required.',
      path: ['recentDescription'],
    }
  );

export type SnoozeFollowUpInput = z.infer<typeof snoozeFollowUpSchema>;

export const followUpIdParamSchema = z.object({
  id: requiredId('id'),
});

export type FollowUpIdParamInput = z.infer<typeof followUpIdParamSchema>;

export const calendarQuerySchema = z
  .object({
    view: calendarViewSchema.default('month'),
    startDate: parseDateField('startDate'),
    endDate: parseDateField('endDate'),
    userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'endDate must be greater than or equal to startDate',
    path: ['endDate'],
  });

export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;

export const todayFollowUpsQuerySchema = z.object({
  userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
});

export type TodayFollowUpsQueryInput = z.infer<typeof todayFollowUpsQuerySchema>;

export const reminderAlertsQuerySchema = z.object({
  userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  minutesAhead: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 15;
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) return 15;
      return Math.min(120, Math.max(1, parsed));
    }),
  includePastMinutes: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return 5;
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) return 5;
      return Math.min(60, Math.max(0, parsed));
    }),
});

export type ReminderAlertsQueryInput = z.infer<typeof reminderAlertsQuerySchema>;

export const historyQuerySchema = z
  .object({
    userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
    startDate: parseOptionalDateField('startDate'),
    endDate: parseOptionalDateField('endDate'),
    status: followUpStatusSchema.optional(),
    page: positiveIntString('page', 1),
    limit: positiveIntString('limit', 20),
  })
  .refine(
    (value) => {
      if (!value.startDate || !value.endDate) return true;
      return value.endDate >= value.startDate;
    },
    {
      message: 'endDate must be greater than or equal to startDate',
      path: ['endDate'],
    },
  );

export type HistoryQueryInput = z.infer<typeof historyQuerySchema>;

export const advancedCalendarSummarySchema = z.object({
  startDate: parseDateField('startDate'),
  endDate: parseDateField('endDate'),
  userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
}).refine((value) => value.endDate >= value.startDate, {
  message: 'endDate must be greater than or equal to startDate',
  path: ['endDate'],
});

export type AdvancedCalendarSummaryInput = z.infer<typeof advancedCalendarSummarySchema>;

export const advancedCalendarDetailsSchema = z.object({
  date: parseDateField('date'),
  type: z.enum(['LEADS_CREATED', 'STAGE_CREATED', 'TOTAL_FOLLOWUPS', 'STAGE_FOLLOWUPS']),
  stageId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  userId: z.preprocess(emptyStringToUndefined, z.string().trim().optional()).optional(),
  page: positiveIntString('page', 1),
  limit: positiveIntString('limit', 20),
});

export type AdvancedCalendarDetailsInput = z.infer<typeof advancedCalendarDetailsSchema>;

export type FollowUpStatus = z.infer<typeof followUpStatusSchema>;
export type FollowUpType = z.infer<typeof followUpTypeSchema>;
export type CalendarView = z.infer<typeof calendarViewSchema>;

export const bulkExtendFollowUpSchema = z.object({
  followUpIds: z.array(z.string().min(1)),
  newFollowupDate: parseDateField('newFollowupDate'),
  extensionReasonId: z.string().trim().max(191).optional().nullable(),
  recentDescription: z.string().trim().max(3000).optional().nullable(),
  autoDistribute: z.boolean().optional().default(false),
}).refine(
  (data) => {
    const hasDescription = typeof data.recentDescription === 'string' && data.recentDescription.trim().length > 0;
    const hasReason = typeof data.extensionReasonId === 'string' && data.extensionReasonId.trim().length > 0;
    return hasDescription || hasReason;
  },
  {
    message: 'Either a Predefined Reason or a Custom Description is required.',
    path: ['recentDescription'],
  }
);

export type BulkExtendFollowUpInput = z.infer<typeof bulkExtendFollowUpSchema>;
