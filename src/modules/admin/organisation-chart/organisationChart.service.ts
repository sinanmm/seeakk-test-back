import prisma from '../../../config/prisma';
import logger from '../../../utils/logger';
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
  office?: { name: string } | null;
};

const buildOrganisationTree = (
  workspaceName: string,
  users: UserRow[],
): { roots: OrganisationChartNode[]; orphanCount: number; cycleBreakCount: number } => {
  const nodeMap = new Map<string, OrganisationChartNode>();
  let orphanCount = 0;
  let cycleBreakCount = 0;

  // 1. Create a USER node for every user
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

  // 2. Link User nodes directly to Supervisors (Supervisor-Subordinate Hierarchy)
  const rootUsers: OrganisationChartNode[] = [];

  users.forEach((user) => {
    const node = nodeMap.get(user.id)!;
    const parentId = user.supervisorId;

    if (!parentId) {
      rootUsers.push(node);
      return;
    }

    if (parentId === user.id) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      rootUsers.push(node);
      return;
    }

    const parentNode = nodeMap.get(parentId);
    if (!parentNode) {
      orphanCount += 1;
      node.isOrphan = true;
      rootUsers.push(node);
      return;
    }

    if (createsCycle(user.id, parentId)) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      rootUsers.push(node);
      return;
    }

    // Attach subordinate directly beneath assigned supervisor
    parentNode.children.push(node);
  });

  // 3. Sort children recursively by name
  const sortSubtreeByName = (nodes: OrganisationChartNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortSubtreeByName(n.children));
  };
  sortSubtreeByName(rootUsers);

  // 4. Calculate member/active team counts recursively
  const calculateTeamCounts = (n: OrganisationChartNode): { total: number; active: number } => {
    let total = n.children.length;
    let active = n.children.filter((c) => c.isActive).length;

    n.children.forEach((c) => {
      const nested = calculateTeamCounts(c);
      total += nested.total;
      active += nested.active;
    });

    n.memberCount = total;
    n.activeCount = active;
    return { total, active };
  };

  rootUsers.forEach((root) => calculateTeamCounts(root));

  // 5. Assign depth levels
  const assignDepthLevels = (nodes: OrganisationChartNode[], currentDepth: number) => {
    nodes.forEach((n) => {
      n.depth = currentDepth;
      assignDepthLevels(n.children, currentDepth + 1);
    });
  };
  assignDepthLevels(rootUsers, 0);

  return { roots: rootUsers, orphanCount, cycleBreakCount };
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

  return response;
};

const buildSupervisorTree = (
  users: UserRow[],
): { roots: OrganisationChartNode[]; orphanCount: number; cycleBreakCount: number } => {
  const nodeMap = new Map<string, OrganisationChartNode>();
  let orphanCount = 0;
  let cycleBreakCount = 0;

  users.forEach((user) => {
    nodeMap.set(user.id, {
      id: user.id,
      name: user.name?.trim() || user.email,
      email: user.email,
      phone: user.phone,
      role: user.role?.name ?? null,
      department: user.department?.name ?? null,
      status: user.office?.name ?? null,
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

  const rootSupervisorUsers: OrganisationChartNode[] = [];

  users.forEach((user) => {
    const node = nodeMap.get(user.id)!;
    const parentId = user.supervisorId;

    if (!parentId) {
      rootSupervisorUsers.push(node);
      return;
    }

    if (parentId === user.id) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      rootSupervisorUsers.push(node);
      return;
    }

    const parentNode = nodeMap.get(parentId);
    if (!parentNode) {
      orphanCount += 1;
      node.isOrphan = true;
      rootSupervisorUsers.push(node);
      return;
    }

    if (createsCycle(user.id, parentId)) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      rootSupervisorUsers.push(node);
      return;
    }

    parentNode.children.push(node);
  });

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

  rootSupervisorUsers.sort((a, b) => {
    if (a.children.length > 0 && b.children.length === 0) return -1;
    if (a.children.length === 0 && b.children.length > 0) return 1;
    if (a.memberCount !== b.memberCount) return (b.memberCount ?? 0) - (a.memberCount ?? 0);
    return a.name.localeCompare(b.name);
  });
  rootSupervisorUsers.forEach((root) => sortTreeByName(root.children));
  assignDepth(rootSupervisorUsers);

  return { roots: rootSupervisorUsers, orphanCount, cycleBreakCount };
};

export const getSupervisorHierarchy = async (
  workspaceId: string,
  query: OrganisationChartQuery,
): Promise<OrganisationChartResponse> => {
  const cacheKey = `organisation_chart_supervisor:${workspaceId}:${query.includeInactive ? 'all' : 'active'}`;

  if (redisClient.isOpen) {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as OrganisationChartResponse;
    }
  }

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
      office: { select: { name: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  const { roots, orphanCount, cycleBreakCount } = buildSupervisorTree(users as UserRow[]);

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
  logger.info(`[Organisation Chart] Details Service Started for userId: ${userId}, workspaceId: ${workspaceId}`);
  logger.info(`[Organisation Chart] Prisma Query Started: User findFirst for ${userId}`);

  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      role: {
        select: {
          id: true,
          name: true,
          permissions: {
            select: { permissionId: true },
          },
        },
      },
      department: { select: { id: true, name: true } },
      office: { select: { id: true, name: true } },
      supervisor: { select: { id: true, name: true, email: true } },
      subordinates: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          role: { select: { name: true } },
        },
      },
    },
  });

  logger.info(`[Organisation Chart] Prisma Query Completed: User query finished for ${userId}`);

  if (!user) {
    logger.warn(`[Organisation Chart] User not found in workspace: ${userId}`);
    const error: any = new Error('User not found in workspace.');
    error.statusCode = 404;
    throw error;
  }

  // Count open leads for this user safely
  let openLeadsCount = 0;
  try {
    openLeadsCount = await prisma.lead.count({
      where: {
        workspaceId,
        assignedToId: userId,
        isClosed: false,
      },
    });
  } catch (e: any) {
    logger.error(`[Organisation Chart] Failed to fetch open leads count for user ${userId}`, { error: e?.message });
  }

  // Fetch today's attendance record safely
  let todayAttendanceStatus = 'NOT_MARKED';
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendanceRecord = await prisma.attendanceRecord.findFirst({
      where: {
        userId,
        workspaceId,
        date: today,
      },
      select: {
        attendanceType: true,
        status: true,
      },
    });

    if (attendanceRecord) {
      todayAttendanceStatus = attendanceRecord.attendanceType || attendanceRecord.status || 'PRESENT';
    }
  } catch (e: any) {
    logger.error(`[Organisation Chart] Failed to fetch attendance record for user ${userId}`, { error: e?.message });
  }

  const result = {
    id: user.id,
    name: user.name || user.email.split('@')[0] || 'User',
    email: user.email,
    phone: user.phone || null,
    isActive: user.isActive,
    createdAt: user.createdAt,
    role: user.role?.name || null,
    department: user.department?.name || null,
    office: user.office?.name || null,
    supervisor: user.supervisor
      ? {
          id: user.supervisor.id,
          name: user.supervisor.name || 'Supervisor',
        }
      : null,
    subordinates: (user.subordinates || []).map((sub) => ({
      id: sub.id,
      name: sub.name || sub.email.split('@')[0] || 'Staff',
      email: sub.email,
      role: sub.role ? { name: sub.role.name } : null,
      isActive: sub.isActive,
    })),
    permissionsCount: user.role?.permissions?.length || 0,
    openLeadsCount,
    todayAttendance: todayAttendanceStatus,
  };

  logger.info(`[Organisation Chart] Response Created for userId: ${userId}`);
  return result;
};
