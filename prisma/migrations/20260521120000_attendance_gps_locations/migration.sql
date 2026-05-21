-- GPS / office location attendance (replaces WiFi/IP validation)

CREATE TABLE IF NOT EXISTS "attendance_office_locations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "officeName" TEXT NOT NULL,
    "branch" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 50,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_office_locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "attendance_office_locations_workspaceId_idx"
    ON "attendance_office_locations"("workspaceId");
CREATE INDEX IF NOT EXISTS "attendance_office_locations_workspaceId_isEnabled_idx"
    ON "attendance_office_locations"("workspaceId", "isEnabled");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "attendanceOfficeLocationId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_attendanceOfficeLocationId_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_attendanceOfficeLocationId_fkey"
      FOREIGN KEY ("attendanceOfficeLocationId")
      REFERENCES "attendance_office_locations"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "calculatedDistanceMeters" DOUBLE PRECISION;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "officeLocationId" TEXT;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "isInsideOfficeRadius" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "attendance_records" ADD COLUMN IF NOT EXISTS "gpsAccuracy" DOUBLE PRECISION;
