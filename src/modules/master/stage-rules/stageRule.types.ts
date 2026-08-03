export type InputTypeValue = 'TEXT' | 'TEXTAREA' | 'RADIO' | 'SELECT';
export type RuleStatusValue = 'ACTIVE' | 'INACTIVE';

export interface StageRuleResponse {
  id: string;
  name: string;
  inputType: InputTypeValue;
  options: string[];
  sortOrder: number;
  required: boolean;
  minCharacters?: number | null;
  status: RuleStatusValue;
  stageId?: string | null;
  createdBy?: string | null;
  createdById?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListStageRulesResponse {
  data: StageRuleResponse[];
  pagination: PaginationMeta;
}

export interface StageTransitionValidationResult {
  isValid: boolean;
  missingFields: string[];
}
