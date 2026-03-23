export type TargetCycleStatus = 'ACTIVE' | 'INACTIVE';

export interface TargetCycleRangeResponse {
  id: string;
  targetCycleId: string;
  startDay: number;
  endDay: number;
  createdAt: Date;
}

export interface TargetCycleResponse {
  id: string;
  name: string;
  workspaceId: string;
  totalDays: number;
  status: TargetCycleStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  ranges: TargetCycleRangeResponse[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListTargetCyclesResponse {
  data: TargetCycleResponse[];
  pagination: PaginationMeta;
}

