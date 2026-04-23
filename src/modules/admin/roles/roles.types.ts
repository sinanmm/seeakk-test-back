import { RoleStatus } from '@prisma/client';

export interface RoleResponse {
  id: string;
  workspaceId?: string;
  name: string;
  status: RoleStatus;
  description?: string | null;
  isSystemRole?: boolean;
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
