-- Default attendance apply type to From Anywhere until admin explicitly sets From Office.
ALTER TABLE "users" ALTER COLUMN "attendanceApplyType" SET DEFAULT 'FROM_ANYWHERE';
ALTER TABLE "attendance_records" ALTER COLUMN "attendanceApplyType" SET DEFAULT 'FROM_ANYWHERE';

-- Reset users who inherited FROM_OFFICE from the previous schema default (not an explicit admin choice).
UPDATE "users" SET "attendanceApplyType" = 'FROM_ANYWHERE' WHERE "attendanceApplyType" = 'FROM_OFFICE';
