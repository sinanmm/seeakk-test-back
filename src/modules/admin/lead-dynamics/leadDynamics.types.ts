export const LEAD_DYNAMIC_INPUT_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DATE',
  'SELECT',
  'RADIO',
  'CHECKBOX',
  'FILE',
  'DATETIME',
] as const;

export type LeadDynamicInputType = (typeof LEAD_DYNAMIC_INPUT_TYPES)[number];

export interface LeadDynamicOptionResponse {
  id: string;
  fieldId: string;
  value: string;
  sortOrder: number;
}

export interface LeadDynamicFieldResponse {
  id: string;
  name: string;
  inputType: LeadDynamicInputType;
  sortOrder: number;
  isRequired: boolean;
  isActive: boolean;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
  options: LeadDynamicOptionResponse[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListLeadDynamicFieldsResponse {
  fields: LeadDynamicFieldResponse[];
  pagination: PaginationMeta;
}

export interface LeadDynamicValueResponse {
  id: string;
  leadId: string;
  fieldId: string;
  value: string;
  createdAt: Date;
}
