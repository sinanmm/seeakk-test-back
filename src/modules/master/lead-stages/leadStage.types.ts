export type StageStatusValue = 'ACTIVE' | 'INACTIVE';

export interface StageRuleResponse {
  id: string;
  stageId: string;
  field: string;
  condition: string;
  value?: string | null;
  isMandatory: boolean;
}

export interface LeadStageResponse {
  id: string;
  name: string;
  color: string;
  isApprovalRequired: boolean;
  isClosed: boolean;
  isLOB: boolean;
  order: number;
  status: StageStatusValue;
  createdBy?: string | null;
  createdById?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  rules: StageRuleResponse[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListLeadStagesResponse {
  data: LeadStageResponse[];
  pagination: PaginationMeta;
}

export interface StageTransitionValidationResult {
  isValid: boolean;
  missingFields: string[];
}
