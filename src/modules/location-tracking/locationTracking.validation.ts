import { z } from 'zod';

const optionalDate = (key: string) =>
  z.preprocess((value) => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }, z.date({ message: `${key} must be a valid date.` }).optional());

export const locationPointSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().nonnegative().optional().nullable(),
  speed: z.coerce.number().nonnegative().optional().nullable(),
  heading: z.coerce.number().min(0).max(360).optional().nullable(),
  batteryPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
  recordedAt: z.preprocess((value) => (value ? new Date(String(value)) : new Date()), z.date()),
  deviceType: z.string().trim().max(80).optional().nullable(),
  source: z.string().trim().max(40).optional(),
});

export const pushLocationSchema = z.object({
  sessionId: z.string().trim().optional(),
  attendanceRecordId: z.string().trim().optional(),
  points: z.array(locationPointSchema).min(1).max(100),
});

export const startSessionSchema = z.object({
  attendanceRecordId: z.string().trim().optional(),
  deviceType: z.string().trim().max(80).optional().nullable(),
});

export const stopSessionSchema = z.object({
  sessionId: z.string().trim().optional(),
  attendanceRecordId: z.string().trim().optional(),
});

export const routeQuerySchema = z.object({
  userId: z.string().trim().min(1),
  date: optionalDate('date'),
  startDate: optionalDate('startDate'),
  endDate: optionalDate('endDate'),
});

export const liveQuerySchema = z.object({
  userId: z.string().trim().optional(),
});

export type PushLocationInput = z.infer<typeof pushLocationSchema>;
export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type StopSessionInput = z.infer<typeof stopSessionSchema>;
export type RouteQueryInput = z.infer<typeof routeQuerySchema>;
export type LiveQueryInput = z.infer<typeof liveQuerySchema>;
