export interface DepartmentResponse {
  id: string;
  name: string;
  description: string | null;
  status: string;
  workspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  _count?: {
    users: number;
  };
}

export interface ListDepartmentsResponse {
  data: DepartmentResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SingleDepartmentResponse {
  success: boolean;
  message: string;
  data: {
    department: DepartmentResponse;
  };
}
