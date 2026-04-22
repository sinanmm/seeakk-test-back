export type StageStatusValue = 'ACTIVE' | 'INACTIVE';

export interface StageRuleResponse {
  id: string;
  name: string;
  inputType: 'TEXT' | 'TEXTAREA' | 'RADIO' | 'SELECT';
  options?: string[];
  sortOrder: number;
  required: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  stageId?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
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
