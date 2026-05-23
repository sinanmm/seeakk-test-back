export type AttendanceSubmissionState =
  | 'NOT_SUBMITTED'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'AUTO_ABSENT'
  | 'HOLIDAY'
  | 'WEEKLY_OFF';

type AttendanceRecordLike = {
  attendanceType: string;
  approvalStatus: string;
  createdBy: string | null;
  checkInTime?: Date | null;
} | null;

export const isSystemGeneratedRecord = (record: AttendanceRecordLike): boolean =>
  record?.createdBy === 'SYSTEM_CRON';

export const isAutoAbsentRecord = (record: AttendanceRecordLike): boolean =>
  Boolean(record && isSystemGeneratedRecord(record) && record.attendanceType === 'ABSENT');

export const resolveAttendanceSubmissionState = (
  record: AttendanceRecordLike,
  isHoliday: boolean,
  isWeeklyOff = false,
): AttendanceSubmissionState => {
  if (isWeeklyOff) return 'WEEKLY_OFF';
  if (isHoliday) return 'HOLIDAY';
  if (!record) return 'NOT_SUBMITTED';
  if (isAutoAbsentRecord(record)) return 'AUTO_ABSENT';
  if (record.approvalStatus === 'REJECTED') return 'REJECTED';
  if (record.approvalStatus === 'PENDING') return 'PENDING';
  if (record.approvalStatus === 'APPROVED') return 'APPROVED';
  return 'NOT_SUBMITTED';
};

export const hasUserSubmittedToday = (submissionState: AttendanceSubmissionState): boolean =>
  submissionState === 'PENDING' || submissionState === 'APPROVED';

export const requiresMandatoryAttendancePopup = (
  submissionState: AttendanceSubmissionState,
  isLocked: boolean,
): boolean => {
  if (isLocked) return false;
  if (submissionState === 'HOLIDAY' || submissionState === 'WEEKLY_OFF') return false;
  return ['NOT_SUBMITTED', 'REJECTED', 'AUTO_ABSENT'].includes(submissionState);
};
