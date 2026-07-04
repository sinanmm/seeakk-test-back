import prisma from '../../../config/prisma';

export const countrySelect = {
  id: true,
  workspaceId: true,
  name: true,
  code: true,
  isActive: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  updatedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
} as const;

export const levelSelect = {
  id: true,
  workspaceId: true,
  countryId: true,
  levelName: true,
  levelOrder: true,
  isActive: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
  updatedBy: {
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
    },
  },
} as const;

export const locationSelect = {
  id: true,
  workspaceId: true,
  name: true,
  type: true,
  countryId: true,
  levelId: true,
  isActive: true,
  createdById: true,
  updatedById: true,
  deletedAt: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  country: {
    select: {
      id: true,
      name: true,
      code: true,
      isActive: true,
    },
  },
  level: {
    select: {
      id: true,
      levelName: true,
      levelOrder: true,
      isActive: true,
    },
  },
  parent: {
    select: {
      id: true,
      name: true,
      levelId: true,
    },
  },
} as const;

export const ensureLocationSchemaReady = async (): Promise<boolean> => {
  const rows = await prisma.$queryRaw<Array<{ ready: boolean }>>`
    SELECT
      (SUM(CASE WHEN table_name = 'countries' THEN 1 ELSE 0 END) > 0)
      AND (SUM(CASE WHEN table_name = 'location_levels' THEN 1 ELSE 0 END) > 0)
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'locations'
          AND column_name = 'countryId'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'locations'
          AND column_name = 'levelId'
      ) AS ready
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('countries', 'location_levels')
  `;

  return Boolean(rows[0]?.ready);
};

export const getRolePermissionKeys = async (roleId: string): Promise<string[]> => {
  const rows = await (prisma as any).rolePermission.findMany({
    where: { roleId },
    include: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return rows.map((row: any) => row.permission.key);
};

export const findCountryByName = async (workspaceId: string, name: string, excludeId?: string) =>
  (prisma as any).country.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      name: {
        equals: name,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const findCountryByCode = async (workspaceId: string, code: string, excludeId?: string) =>
  (prisma as any).country.findFirst({
    where: {
      workspaceId,
      deletedAt: null,
      code: {
        equals: code,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const createCountryWithRootLocation = async (
  countryData: any,
  rootLocationData: any,
) =>
  prisma.$transaction(async (tx: any) => {
    const country = await (tx as any).country.create({
      data: countryData,
      select: countrySelect,
    });

    await (tx as any).location.create({
      data: {
        ...rootLocationData,
        countryId: country.id,
      },
      select: locationSelect,
    });

    return country;
  });

export const listCountries = async (where: any, skip: number, take: number) => {
  const [rows, total] = await Promise.all([
    (prisma as any).country.findMany({
      where,
      skip,
      take,
      orderBy: [{ createdAt: 'desc' }],
      select: countrySelect,
    }),
    (prisma as any).country.count({ where }),
  ]);

  return { rows, total };
};

export const findCountryById = async (workspaceId: string, id: string) =>
  (prisma as any).country.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: countrySelect,
  });

export const updateCountry = async (id: string, data: any) =>
  (prisma as any).country.update({
    where: { id },
    data,
    select: countrySelect,
  });

export const countActiveCountryLocations = async (workspaceId: string, countryId: string) =>
  (prisma as any).location.count({
    where: {
      workspaceId,
      countryId,
      deletedAt: null,
      levelId: { not: null },
    },
  });

export const findCountryRootLocation = async (workspaceId: string, countryId: string) =>
  (prisma as any).location.findFirst({
    where: {
      workspaceId,
      countryId,
      parentId: null,
      deletedAt: null,
    },
    select: locationSelect,
    orderBy: [{ createdAt: 'asc' }],
  });

export const createCountryRootLocation = async (data: any) =>
  (prisma as any).location.create({
    data,
    select: locationSelect,
  });

export const listLocationLevels = async (workspaceId: string, countryId?: string) =>
  (prisma as any).locationLevel.findMany({
    where: {
      workspaceId,
      ...(countryId ? { countryId } : {}),
    },
    orderBy: [{ countryId: 'asc' }, { levelOrder: 'asc' }],
    select: levelSelect,
  });

export const findLocationLevelById = async (workspaceId: string, id: string) =>
  (prisma as any).locationLevel.findFirst({
    where: {
      id,
      workspaceId,
    },
    select: levelSelect,
  });

export const findLocationLevelByOrder = async (workspaceId: string, countryId: string, levelOrder: number) =>
  (prisma as any).locationLevel.findFirst({
    where: {
      workspaceId,
      countryId,
      levelOrder,
    },
    select: levelSelect,
  });

export const configureLocationLevels = async (
  workspaceId: string,
  countryId: string,
  actorId: string,
  levels: Array<{ name: string; order: number; isActive?: boolean }>,
) =>
  prisma.$transaction(async (tx: any) => {
      const existing = await (tx as any).locationLevel.findMany({
      where: {
        workspaceId,
        countryId,
      },
      orderBy: {
        levelOrder: 'asc',
      },
    });

    const existingByOrder = new Map(existing.map((level: any) => [level.levelOrder, level]));
    const requestedOrders = new Set(levels.map((level) => level.order));

    for (const existingLevel of existing) {
      if (requestedOrders.has(existingLevel.levelOrder)) continue;

      const usedCount = await (tx as any).location.count({
        where: {
          workspaceId,
          countryId,
          levelId: existingLevel.id,
          deletedAt: null,
        },
      });

      if (usedCount > 0) {
        throw Object.assign(new Error(`Cannot remove level order ${existingLevel.levelOrder} because locations already exist.`), {
          statusCode: 409,
        });
      }

      await (tx as any).locationLevel.update({
        where: { id: existingLevel.id },
        data: {
          isActive: false,
          updatedById: actorId,
        },
      });
    }

    for (const level of levels) {
      const current = existingByOrder.get(level.order) as any;
      if (current) {
        await (tx as any).locationLevel.update({
          where: { id: current.id },
          data: {
            levelName: level.name,
            isActive: level.isActive ?? true,
            updatedById: actorId,
          },
        });
        continue;
      }

      await (tx as any).locationLevel.create({
        data: {
          workspaceId,
          countryId,
          levelName: level.name,
          levelOrder: level.order,
          isActive: level.isActive ?? true,
          createdById: actorId,
          updatedById: actorId,
        },
      });
    }

    return (tx as any).locationLevel.findMany({
      where: {
        workspaceId,
        countryId,
      },
      orderBy: { levelOrder: 'asc' },
      select: levelSelect,
    });
  });

export const listLocations = async (where: any) =>
  (prisma as any).location.findMany({
    where,
    orderBy: [{ name: 'asc' }],
    select: locationSelect,
  });

export const findLocationById = async (workspaceId: string, id: string) =>
  (prisma as any).location.findFirst({
    where: {
      id,
      workspaceId,
      deletedAt: null,
    },
    select: locationSelect,
  });

export const findLocationByNameInParent = async (
  workspaceId: string,
  countryId: string,
  parentId: string | null,
  name: string,
  excludeId?: string,
) =>
  (prisma as any).location.findFirst({
    where: {
      workspaceId,
      countryId,
      parentId,
      deletedAt: null,
      name: {
        equals: name,
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

export const createLocation = async (data: any) =>
  (prisma as any).location.create({
    data,
    select: locationSelect,
  });

export const updateLocation = async (id: string, data: any) =>
  (prisma as any).location.update({
    where: { id },
    data,
    select: locationSelect,
  });

export const countLocationChildren = async (workspaceId: string, parentId: string) =>
  (prisma as any).location.count({
    where: {
      workspaceId,
      parentId,
      deletedAt: null,
    },
  });

