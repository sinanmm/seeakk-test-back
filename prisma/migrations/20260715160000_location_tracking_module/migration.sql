CREATE TABLE IF NOT EXISTS "location_sessions" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "attendanceRecordId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stoppedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startedBy" TEXT,
  "stoppedBy" TEXT,
  "deviceType" TEXT,
  "lastLatitude" DOUBLE PRECISION,
  "lastLongitude" DOUBLE PRECISION,
  "lastAccuracy" DOUBLE PRECISION,
  "lastSpeed" DOUBLE PRECISION,
  "lastHeading" DOUBLE PRECISION,
  "lastBattery" DOUBLE PRECISION,
  "lastUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "location_points" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "attendanceRecordId" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "accuracy" DOUBLE PRECISION,
  "speed" DOUBLE PRECISION,
  "heading" DOUBLE PRECISION,
  "batteryPercentage" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "deviceType" TEXT,
  "source" TEXT NOT NULL DEFAULT 'web',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "location_stops" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "attendanceRecordId" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_stops_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_sessions_userId_fkey') THEN
    ALTER TABLE "location_sessions"
      ADD CONSTRAINT "location_sessions_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_sessions_attendanceRecordId_fkey') THEN
    ALTER TABLE "location_sessions"
      ADD CONSTRAINT "location_sessions_attendanceRecordId_fkey"
      FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_points_userId_fkey') THEN
    ALTER TABLE "location_points"
      ADD CONSTRAINT "location_points_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_points_sessionId_fkey') THEN
    ALTER TABLE "location_points"
      ADD CONSTRAINT "location_points_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "location_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_points_attendanceRecordId_fkey') THEN
    ALTER TABLE "location_points"
      ADD CONSTRAINT "location_points_attendanceRecordId_fkey"
      FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_stops_userId_fkey') THEN
    ALTER TABLE "location_stops"
      ADD CONSTRAINT "location_stops_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'location_stops_sessionId_fkey') THEN
    ALTER TABLE "location_stops"
      ADD CONSTRAINT "location_stops_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "location_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "location_sessions_workspaceId_status_idx" ON "location_sessions"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "location_sessions_workspaceId_userId_startedAt_idx" ON "location_sessions"("workspaceId", "userId", "startedAt");
CREATE INDEX IF NOT EXISTS "location_sessions_attendanceRecordId_idx" ON "location_sessions"("attendanceRecordId");
CREATE INDEX IF NOT EXISTS "location_points_workspaceId_recordedAt_idx" ON "location_points"("workspaceId", "recordedAt");
CREATE INDEX IF NOT EXISTS "location_points_workspaceId_userId_recordedAt_idx" ON "location_points"("workspaceId", "userId", "recordedAt");
CREATE INDEX IF NOT EXISTS "location_points_sessionId_recordedAt_idx" ON "location_points"("sessionId", "recordedAt");
CREATE INDEX IF NOT EXISTS "location_stops_workspaceId_userId_startedAt_idx" ON "location_stops"("workspaceId", "userId", "startedAt");
CREATE INDEX IF NOT EXISTS "location_stops_sessionId_idx" ON "location_stops"("sessionId");
