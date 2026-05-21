import { z } from 'zod';

export const markAttendanceSchema = z.object({
  attendanceType: z.enum(['PRESENT', 'HALF_DAY', 'LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'ABSENT']),
  checkInTime: z.string().datetime().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  
  // Network and geo meta fields
  ipAddress: z.string().optional().nullable(),
  networkName: z.string().optional().nullable(),
  routerIp: z.string().optional().nullable(),
  subnet: z.string().optional().nullable(),
  deviceInfo: z.string().optional().nullable(),
  geoLocation: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  attachmentUrl: z.string().optional().nullable(),
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

export const attendanceQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be in YYYY-MM-DD format').optional(),
  userId: z.string().optional(),
  departmentId: z.string().optional(),
  roleId: z.string().optional(),
  attendanceType: z.enum(['PRESENT', 'HALF_DAY', 'LEAVE', 'WORK_FROM_HOME', 'HOLIDAY', 'ABSENT']).optional(),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  isLocked: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  page: z.preprocess((val) => parseInt(val as string, 10) || 1, z.number().int().min(1)).default(1),
  limit: z.preprocess((val) => parseInt(val as string, 10) || 10, z.number().int().min(1)).default(10),
});

export const attendanceNetworkSchema = z.object({
  officeName: z.string().min(1, 'Office name is required'),
  branch: z.string().optional().nullable(),
  wifiSsid: z.string().min(1, 'SSID is required'),
  routerIp: z.string().min(1, 'Router IP is required'),
  gateway: z.string().optional().nullable(),
  allowedIpRanges: z.string().optional().nullable(),
  subnet: z.string().optional().nullable(),
  macValidation: z.string().optional().nullable(),
  isEnabled: z.boolean().default(true),
});
