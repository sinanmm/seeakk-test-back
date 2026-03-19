import { RoleStatus } from './roles.validator';

export interface RoleResponse {
  id: string;
  name: string;
  status: RoleStatus;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissionsCount?: number;
  permissions?: string[];
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListRolesResponse {
  data: RoleResponse[];
  pagination: PaginationMeta;
}
