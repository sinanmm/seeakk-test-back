import { z } from 'zod';

const rosterTypeSchema = z.enum(['HOLIDAY', 'WEEKLY_OFF', 'SHIFT', 'SPECIAL_WORKING_DAY']);
const rosterStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const shiftSessionSchema = z.enum(['DAY', 'NIGHT']);
const timeHHmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:mm format');

const toDate = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return undefined;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? value : parsed;
};

const dateSchema = z.preprocess(toDate, z.date());
const optionalDateSchema = z.preprocess(toDate, z.date().optional().nullable());

export const createRosterEntrySchema = z
  .object({
    userId: z.string().trim().min(1, 'User is required'),
    rosterType: rosterTypeSchema,
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120, 'Name too long'),
    startDate: dateSchema,
    endDate: optionalDateSchema,
    shiftSession: shiftSessionSchema.optional().nullable(),
    shiftStartTime: timeHHmmSchema.optional().nullable(),
    shiftEndTime: timeHHmmSchema.optional().nullable(),
    status: rosterStatusSchema.default('ACTIVE'),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: 'endDate cannot be before startDate',
    path: ['endDate'],
  })
  .superRefine((value, ctx) => {
    if (value.rosterType === 'SHIFT') {
      if (!value.shiftSession) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift session is required for SHIFT', path: ['shiftSession'] });
      }
      if (!value.shiftStartTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift start time is required for SHIFT', path: ['shiftStartTime'] });
      }
      if (!value.shiftEndTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift end time is required for SHIFT', path: ['shiftEndTime'] });
      }
      if (value.shiftStartTime && value.shiftEndTime && value.shiftStartTime >= value.shiftEndTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift end time must be later than shift start time', path: ['shiftEndTime'] });
      }
    }
  });

export type CreateRosterEntryInput = z.infer<typeof createRosterEntrySchema>;

export const updateRosterEntrySchema = z
  .object({
    rosterType: rosterTypeSchema.optional(),
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120, 'Name too long').optional(),
    startDate: dateSchema.optional(),
    endDate: optionalDateSchema,
    shiftSession: shiftSessionSchema.optional().nullable(),
    shiftStartTime: timeHHmmSchema.optional().nullable(),
    shiftEndTime: timeHHmmSchema.optional().nullable(),
    status: rosterStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.rosterType !== undefined ||
      value.name !== undefined ||
      value.startDate !== undefined ||
      value.endDate !== undefined ||
      value.shiftSession !== undefined ||
      value.shiftStartTime !== undefined ||
      value.shiftEndTime !== undefined ||
      value.status !== undefined,
    { message: 'At least one field is required for update' },
  );

export type UpdateRosterEntryInput = z.infer<typeof updateRosterEntrySchema>;

export const listRosterUsersQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((value) => (value ? Math.max(1, parseInt(value, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((value) => (value ? Math.min(100, Math.max(1, parseInt(value, 10))) : 10)),
  search: z.string().optional().default(''),
  departmentId: z.string().trim().min(1).optional(),
  supervisorId: z.string().trim().min(1).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type ListRosterUsersQuery = z.infer<typeof listRosterUsersQuerySchema>;

export const bulkAssignDepartmentSchema = z
  .object({
    departmentId: z.string().trim().min(1, 'Department is required'),
    rosterType: rosterTypeSchema,
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120, 'Name too long'),
    startDate: dateSchema,
    endDate: optionalDateSchema,
    shiftSession: shiftSessionSchema.optional().nullable(),
    shiftStartTime: timeHHmmSchema.optional().nullable(),
    shiftEndTime: timeHHmmSchema.optional().nullable(),
    status: rosterStatusSchema.default('ACTIVE'),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: 'endDate cannot be before startDate',
    path: ['endDate'],
  })
  .superRefine((value, ctx) => {
    if (value.rosterType === 'SHIFT') {
      if (!value.shiftSession) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift session is required for SHIFT', path: ['shiftSession'] });
      }
      if (!value.shiftStartTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift start time is required for SHIFT', path: ['shiftStartTime'] });
      }
      if (!value.shiftEndTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift end time is required for SHIFT', path: ['shiftEndTime'] });
      }
      if (value.shiftStartTime && value.shiftEndTime && value.shiftStartTime >= value.shiftEndTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shift end time must be later than shift start time', path: ['shiftEndTime'] });
      }
    }
  });

export type BulkAssignDepartmentInput = z.infer<typeof bulkAssignDepartmentSchema>;
