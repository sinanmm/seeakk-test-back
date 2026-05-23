import { z } from 'zod';

export const markAttendanceSchema = z.object({
  attendanceType: z.enum(['PRESENT', 'HALF_DAY', 'LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'WEEKLY_OFF', 'ABSENT']),
  checkInTime: z.string().datetime().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  gpsAccuracy: z.coerce.number().min(0).optional().nullable(),
  locationCapturedAt: z.string().datetime().optional().nullable(),
  deviceInfo: z.string().optional().nullable(),
  geoLocation: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  attachmentUrl: z.string().optional().nullable(),
  clientChannel: z.enum(['web', 'mobile']).optional(),
});

export const updateSettingsSchema = z.object({
  cutoffTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format').optional(),
  enableWarning: z.boolean().optional(),
  warningThreshold: z.number().int().min(1).optional(),
  enableAutoLock: z.boolean().optional(),
  attendanceStartTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format').optional(),
  lateMarkTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format').optional(),
  autoAbsentTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be in HH:MM format').optional(),
  approvalRequired: z.boolean().optional(),
});

const emptyStringToUndefined = (val: unknown) => {
  if (typeof val === 'string' && val.trim() === '') {
    return undefined;
  }
  return val;
};

export const attendanceQuerySchema = z.object({
  startDate: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  ),
  endDate: z.preprocess(
    emptyStringToUndefined,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  ),
  userId: z.preprocess(emptyStringToUndefined, z.string().optional()),
  departmentId: z.preprocess(emptyStringToUndefined, z.string().optional()),
  roleId: z.preprocess(emptyStringToUndefined, z.string().optional()),
  attendanceType: z.preprocess(
    emptyStringToUndefined,
    z.enum(['PRESENT', 'HALF_DAY', 'LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'WEEKLY_OFF', 'ABSENT']).optional(),
  ),
  approvalStatus: z.preprocess(
    emptyStringToUndefined,
    z.enum(['PENDING', 'APPROVED', 'REJECTED', 'NOT_SUBMITTED']).optional(),
  ),
  isLocked: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  page: z.preprocess((val) => parseInt(val as string, 10) || 1, z.number().int().min(1)).default(1),
  limit: z.preprocess((val) => parseInt(val as string, 10) || 50, z.number().int().min(1).max(200)).default(50),
});

export const attendanceOfficeLocationSchema = z.object({
  officeName: z.string().min(1, 'Office name is required'),
  branch: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10).max(500).default(50),
  isEnabled: z.boolean().default(true),
});

/** @deprecated Use attendanceOfficeLocationSchema — kept for legacy /networks route body mapping */
export const attendanceNetworkSchema = attendanceOfficeLocationSchema;

export const assignOfficeBranchSchema = z.object({
  attendanceOfficeLocationId: z.string().uuid().nullable(),
});
