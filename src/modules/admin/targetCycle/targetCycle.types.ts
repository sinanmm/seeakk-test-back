export type TargetCycleStatus = 'ACTIVE' | 'INACTIVE';

export interface TargetCycleRangeResponse {
  id: string;
  targetCycleId: string;
  startDay: number;
  endDay: number;
  createdAt: Date;
}

export interface TargetCyclePeriodResponse {
  id: string;
  targetCycleId: string;
  label: string;
  periodIndex: number;
  targetCount: number;
  startDate: Date | string;
  endDate: Date | string;
  lockingDate: Date | string;
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
  description?: string | null;
  targetType?: string;
  targetMetric?: string;
  leadStageId?: string | null;
  startDate?: Date | string;
  endDate?: Date | string | null;
  numberOfMonths?: number | null;
  lockingEnabled?: boolean;
  periods?: TargetCyclePeriodResponse[];
  leadStage?: { id: string; name: string; color?: string | null } | null;
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

