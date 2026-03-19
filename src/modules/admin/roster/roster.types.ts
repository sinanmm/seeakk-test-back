export type RosterType = 'HOLIDAY' | 'WEEKLY_OFF' | 'SHIFT' | 'SPECIAL_WORKING_DAY';
export type RosterStatus = 'ACTIVE' | 'INACTIVE';
export type ShiftSession = 'DAY' | 'NIGHT';

export interface RosterEntryDTO {
  id: string;
  userId: string;
  rosterType: RosterType;
  name: string;
  startDate: Date;
  endDate: Date | null;
  shiftSession: ShiftSession | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  status: RosterStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RosterUsersListItem {
  id: string;
  name: string;
  email: string;
  department: string | null;
  supervisor: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RosterUsersListResponse {
  data: RosterUsersListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface BulkDepartmentAssignResult {
  totalUsers: number;
  createdCount: number;
  skippedCount: number;
  skippedUserIds: string[];
}
