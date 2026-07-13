export type OrganisationNodeType = 'WORKSPACE' | 'DEPARTMENT' | 'USER';

export interface OrganisationChartNode {
  id: string;
  name: string;
  nodeType: OrganisationNodeType;
  email?: string;
  role?: string | null;
  department?: string | null;
  reportingTo?: string | null;
  depth: number;
  isActive?: boolean;
  isOrphan?: boolean;
  children: OrganisationChartNode[];
  
  // Extra fields for users and supervisors
  avatarUrl?: string | null;
  employeeId?: string | null;
  status?: string | null;
  phone?: string | null;
  memberCount?: number;
  activeCount?: number;
}

export interface OrganisationChartMeta {
  totalUsers: number;
  rootCount: number;
  orphanCount: number;
  cycleBreakCount: number;
}

export interface OrganisationChartResponse {
  data: OrganisationChartNode[];
  meta: OrganisationChartMeta;
}

