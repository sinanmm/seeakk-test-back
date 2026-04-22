import prisma from '../../config/prisma';
import logger from '../../utils/logger';

export const getLocationTree = async (workspaceId: string, parentId: string | null = null) => {
  return (prisma as any).location.findMany({
    where: { workspaceId, parentId, deletedAt: null, isActive: true },
    include: {
      children: {
        where: {
          deletedAt: null,
          isActive: true,
        },
        include: {
          children: {
            where: {
              deletedAt: null,
              isActive: true,
            },
          }
        }
      }
    },
    orderBy: { name: 'asc' },
  });
};

export const getAllLocations = async (workspaceId: string) => {
  return (prisma as any).location.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      isActive: true,
      countryId: { not: null },
    },
    include: {
      level: {
        select: {
          id: true,
          levelName: true,
          levelOrder: true,
        },
      },
    },
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
  });
};

export const createLocation = async (data: { name: string; type: any; parentId?: string; workspaceId: string }) => {
  return (prisma as any).location.create({
    data
  });
};

/**
 * Get the visible locations for a user based on their assignments.
 * If a user is assigned a parent location, they see it and ALL its descendants.
 */
export const getUserVisibleLocations = async (userId: string, workspaceId: string) => {
  // 1. Get user assignments
  const assignments = await (prisma as any).userLocationAssignment.findMany({
    where: { userId, workspaceId },
    include: { location: true }
  });

  if (assignments.length === 0) {
    // If no assignment, maybe they can see nothing or everything? 
    // Usually, if we have a strict boundary, they see nothing.
    // However, if they are Admin, they might see everything.
    // We should check role in the controller/caller.
    return [];
  }

  const assignedLocationIds = assignments.map((a: any) => a.locationId);
  
  // 2. Fetch all descendants for these locations
  // Note: For deep trees, we might need a recursive CTE or fetch all and filter in JS
  // For simplicity, we'll fetch all locations in workspace and filter in memory if the dataset is small,
  // or use a flat structure for selection.
  const allLocations = await (prisma as any).location.findMany({
    where: { workspaceId }
  });

  const getDescendants = (parentId: string, list: any[]): any[] => {
    const children = list.filter(l => l.parentId === parentId);
    return children.reduce((acc, child) => [...acc, child, ...getDescendants(child.id, list)], []);
  };

  const visibleLocations: any[] = [];
  const processedIds = new Set<string>();

  for (const assignment of assignments) {
    if (!processedIds.has(assignment.locationId)) {
      visibleLocations.push(assignment.location);
      processedIds.add(assignment.locationId);
      
      const descendants = getDescendants(assignment.locationId, allLocations);
      for (const d of descendants) {
        if (!processedIds.has(d.id)) {
          visibleLocations.push(d);
          processedIds.add(d.id);
        }
      }
    }
  }

  return visibleLocations;
};
