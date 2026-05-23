-- Workspace-level weekly off configuration
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffDays" INTEGER[] NOT NULL DEFAULT ARRAY[0]::INTEGER[];
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "weeklyOffColor" TEXT NOT NULL DEFAULT '#cbd5e1';

-- Attendance type for weekly off days
ALTER TYPE "AttendanceType" ADD VALUE IF NOT EXISTS 'WEEKLY_OFF';
