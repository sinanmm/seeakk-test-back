import prisma from '../../../config/prisma';
import { redisClient } from '../../../config/redis';
import {
  OrganisationChartNode,
  OrganisationChartResponse,
} from './organisationChart.types';
import { OrganisationChartQuery } from './organisationChart.validator';

const ORG_CHART_CACHE_TTL_SECONDS = 180;

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  isActive: boolean;
  supervisorId: string | null;
  departmentId: string | null;
  phone: string | null;
  role: { name: string } | null;
  department: { name: string } | null;
};

const sortTreeByName = (nodes: OrganisationChartNode[]): void => {
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  nodes.forEach((node) => sortTreeByName(node.children));
};

const assignDepth = (roots: OrganisationChartNode[]): void => {
  const queue: Array<{ node: OrganisationChartNode; depth: number }> = roots.map((root) => ({
    node: root,
    depth: 0,
  }));

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    next.node.depth = next.depth;
    next.node.children.forEach((child) => queue.push({ node: child, depth: next.depth + 1 }));
  }
};

const buildOrganisationTree = (
  workspaceName: string,
  users: UserRow[],
): { roots: OrganisationChartNode[]; orphanCount: number; cycleBreakCount: number } => {
  const nodeMap = new Map<string, OrganisationChartNode>();
  let orphanCount = 0;
  let cycleBreakCount = 0;

  // 1. Create User nodes
  users.forEach((user) => {
    nodeMap.set(user.id, {
      id: user.id,
      name: user.name?.trim() || user.email,
      email: user.email,
      phone: user.phone,
      role: user.role?.name ?? null,
      department: user.department?.name ?? null,
      reportingTo: user.supervisorId,
      nodeType: 'USER',
      depth: 0,
      isActive: user.isActive,
      isOrphan: false,
      children: [],
      memberCount: 0,
      activeCount: 0,
    });
  });

  const createsCycle = (childId: string, parentId: string): boolean => {
    let current: string | null = parentId;
    const visited = new Set<string>();

    while (current) {
      if (current === childId) return true;
      if (visited.has(current)) return true;
      visited.add(current);
      const node = nodeMap.get(current);
      current = node?.reportingTo ?? null;
    }
    return false;
  };

  // 2. Link User nodes to Supervisors globally
  const noSupervisorUsers: OrganisationChartNode[] = [];

  users.forEach((user) => {
    const node = nodeMap.get(user.id)!;
    const parentId = user.supervisorId;

    if (!parentId) {
      noSupervisorUsers.push(node);
      return;
    }

    if (parentId === user.id) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      noSupervisorUsers.push(node);
      return;
    }

    const parentNode = nodeMap.get(parentId);
    if (!parentNode) {
      orphanCount += 1;
      node.isOrphan = true;
      noSupervisorUsers.push(node);
      return;
    }

    if (createsCycle(user.id, parentId)) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      noSupervisorUsers.push(node);
      return;
    }

    parentNode.children.push(node);
  });

  // Calculate team counts for supervisors
  nodeMap.forEach((node) => {
    if (node.children.length > 0) {
      const countMembers = (n: OrganisationChartNode): { total: number; active: number } => {
        let total = n.children.length;
        let active = n.children.filter((c) => c.isActive).length;
        n.children.forEach((c) => {
          const nested = countMembers(c);
          total += nested.total;
          active += nested.active;
        });
        return { total, active };
      };
      const counts = countMembers(node);
      node.memberCount = counts.total;
      node.activeCount = counts.active;
    }
  });

  // 3. Group remaining top-level users by Department
  const departmentNodes = new Map<string, OrganisationChartNode>();
  
  noSupervisorUsers.forEach((userNode) => {
    const userRow = users.find((u) => u.id === userNode.id);
    const deptName = userRow?.department?.name || 'Unassigned';
    
    if (!departmentNodes.has(deptName)) {
      departmentNodes.set(deptName, {
        id: `dept-${deptName}`,
        name: deptName,
        nodeType: 'DEPARTMENT',
        depth: 0,
        children: [],
      });
    }
    departmentNodes.get(deptName)!.children.push(userNode);
  });

  const sortedDepts = Array.from(departmentNodes.values());
  sortTreeByName(sortedDepts);

  // 4. Create Workspace Root
  const rootNode: OrganisationChartNode = {
    id: 'root-workspace',
    name: workspaceName || 'Company',
    nodeType: 'WORKSPACE',
    depth: 0,
    children: sortedDepts,
  };

  const roots = [rootNode];
  assignDepth(roots);

  return { roots, orphanCount, cycleBreakCount };
};

export const getOrganisationChart = async (
  workspaceId: string,
  query: OrganisationChartQuery,
): Promise<OrganisationChartResponse> => {
  const cacheKey = `organisation_chart:${workspaceId}:${query.includeInactive ? 'all' : 'active'}`;

  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as OrganisationChartResponse;
    }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { companyName: true },
  });

  const users = await prisma.user.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(query.includeInactive ? {} : { isActive: true }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      supervisorId: true,
      departmentId: true,
      phone: true,
      role: { select: { name: true } },
      department: { select: { name: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  const { roots, orphanCount, cycleBreakCount } = buildOrganisationTree(workspace?.companyName || 'Workspace', users as UserRow[]);

  const response: OrganisationChartResponse = {
    data: roots,
    meta: {
      totalUsers: users.length,
      rootCount: roots.length,
      orphanCount,
      cycleBreakCount,
    },
  };

  if (redisClient.isOpen) {
    redisClient.setEx(cacheKey, ORG_CHART_CACHE_TTL_SECONDS, JSON.stringify(response)).catch(() => {});
  }

  return response;
};

export const getUserDetails = async (workspaceId: string, userId: string) => {
  const user = await (prisma as any).user.findFirst({
    where: { id: userId, workspaceId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      role: { select: { name: true, permissions: true } },
      department: { select: { name: true } },
      supervisor: { select: { name: true, id: true } },
      subordinates: { select: { id: true, name: true, email: true, role: { select: { name: true } }, isActive: true } },
      _count: {
        select: {
          assignedLeads: { where: { isClosed: false } }
        }
      }
    }
  });

  if (!user) throw new Error('User not found in workspace.');

  // Attendance for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const attendance = await (prisma as any).attendanceLog?.findFirst({
    where: {
      userId,
      workspaceId,
      date: today,
    },
    select: {
      status: true,
    }
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    isActive: user.isActive,
    createdAt: user.createdAt,
    role: user.role?.name || null,
    department: user.department?.name || null,
    supervisor: user.supervisor,
    subordinates: user.subordinates || [],
    permissionsCount: user.role?.permissions?.length || 0,
    openLeadsCount: user._count?.assignedLeads || 0,
    todayAttendance: attendance?.status || 'NOT_MARKED',
  };
};
