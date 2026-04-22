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
  users: UserRow[],
): { roots: OrganisationChartNode[]; orphanCount: number; cycleBreakCount: number } => {
  const nodeMap = new Map<string, OrganisationChartNode>();
  const roots: OrganisationChartNode[] = [];
  let orphanCount = 0;
  let cycleBreakCount = 0;

  users.forEach((user) => {
    nodeMap.set(user.id, {
      id: user.id,
      name: user.name?.trim() || user.email,
      email: user.email,
      role: user.role?.name ?? null,
      department: user.department?.name ?? null,
      reportingTo: user.supervisorId,
      nodeType: 'STAFF',
      depth: 0,
      isActive: user.isActive,
      isOrphan: false,
      children: [],
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

  users.forEach((user) => {
    const node = nodeMap.get(user.id)!;
    const parentId = user.supervisorId;

    if (!parentId) {
      roots.push(node);
      return;
    }

    if (parentId === user.id) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      roots.push(node);
      return;
    }

    const parentNode = nodeMap.get(parentId);
    if (!parentNode) {
      orphanCount += 1;
      node.isOrphan = true;
      roots.push(node);
      return;
    }

    if (createsCycle(user.id, parentId)) {
      cycleBreakCount += 1;
      node.isOrphan = true;
      roots.push(node);
      return;
    }

    parentNode.children.push(node);
  });

  nodeMap.forEach((node) => {
    if (!node.reportingTo) {
      node.nodeType = 'TOP';
      return;
    }
    node.nodeType = node.children.length > 0 ? 'MANAGER' : 'STAFF';
  });

  sortTreeByName(roots);
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
      role: { select: { name: true } },
      department: { select: { name: true } },
    },
    orderBy: [{ name: 'asc' }],
  });

  const { roots, orphanCount, cycleBreakCount } = buildOrganisationTree(users as UserRow[]);

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
    await redisClient.setEx(cacheKey, ORG_CHART_CACHE_TTL_SECONDS, JSON.stringify(response));
  }

  return response;
};
