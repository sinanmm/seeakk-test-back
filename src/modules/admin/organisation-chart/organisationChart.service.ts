import prisma from '../../../config/prisma';
import logger from '../../../utils/logger';
import { redisClient } from '../../../config/redis';
import auditService from '../../../services/Audit/auditService';
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

export const moveUserNode = async (
  workspaceId: string,
  userId: string,
  supervisorId: string | null,
  actorId: string,
): Promise<void> => {
  logger.info(`[Organisation Chart] Moving node userId: ${userId} under supervisorId: ${supervisorId}`);

  // 1. Verify target user exists and belongs to the same workspace
  const user = await prisma.user.findFirst({
    where: { id: userId, workspaceId, deletedAt: null },
  });
  if (!user) {
    const error: any = new Error('Target user not found or does not belong to your workspace.');
    error.statusCode = 404;
    throw error;
  }

  // 2. If supervisorId is provided, verify they exist and belong to the same workspace
  if (supervisorId) {
    if (userId === supervisorId) {
      const error: any = new Error('A user cannot report to themselves.');
      error.statusCode = 400;
      throw error;
    }

    const supervisor = await prisma.user.findFirst({
      where: { id: supervisorId, workspaceId, deletedAt: null },
    });
    if (!supervisor) {
      const error: any = new Error('Supervisor not found or does not belong to your workspace.');
      error.statusCode = 404;
      throw error;
    }

    // 3. Cycle prevention check: make sure the supervisor is not a descendant of the user
    let currentSupervisorId: string | null = supervisorId;
    const visited = new Set<string>();
    while (currentSupervisorId) {
      if (currentSupervisorId === userId) {
        const error: any = new Error('Circular reporting structure detected. You cannot assign a user under their own subordinate.');
        error.statusCode = 400;
        throw error;
      }
      if (visited.has(currentSupervisorId)) {
        break; // Guard against existing DB loops
      }
      visited.add(currentSupervisorId);
      
      const parentUser: { supervisorId: string | null } | null = await (prisma as any).user.findUnique({
        where: { id: currentSupervisorId },
        select: { supervisorId: true },
      });
      currentSupervisorId = parentUser?.supervisorId ?? null;
    }
  }

  // 4. Perform the update
  const previousSupervisorId = user.supervisorId;
  await prisma.user.update({
    where: { id: userId },
    data: { supervisorId },
  });

  // 5. Invalidate the Redis cache for this workspace's organization chart
  if (redisClient.isOpen) {
    const cacheKeyAll = `organisation_chart:${workspaceId}:all`;
    const cacheKeyActive = `organisation_chart:${workspaceId}:active`;
    await Promise.all([
      redisClient.del(cacheKeyAll).catch(() => {}),
      redisClient.del(cacheKeyActive).catch(() => {}),
    ]);
  }

  // 6. Log the change in the Audit Log
  await auditService.log({
    userId: actorId,
    workspaceId,
    action: 'ORGANISATION_CHART_MOVE',
    entityType: 'User',
    entityId: userId,
    details: {
      movedUserId: userId,
      previousSupervisorId,
      newSupervisorId: supervisorId,
    },
  });
};

