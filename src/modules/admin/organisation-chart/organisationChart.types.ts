export type OrganisationNodeType = 'TOP' | 'MANAGER' | 'STAFF';

export interface OrganisationChartNode {
  id: string;
  name: string;
  email: string;
  role: string | null;
  department: string | null;
  reportingTo: string | null;
  nodeType: OrganisationNodeType;
  depth: number;
  isActive: boolean;
  isOrphan: boolean;
  children: OrganisationChartNode[];
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

