export type LeadSourceStatusValue = 'ACTIVE' | 'INACTIVE';

export interface LeadSourceResponse {
  id: string;
  name: string;
  status: LeadSourceStatusValue;
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

export interface ListLeadSourcesResponse {
  data: LeadSourceResponse[];
  pagination: PaginationMeta;
}
