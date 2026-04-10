import { LocationType } from '../../../../prisma/generated/client';
import auditService from '../../../services/Audit/auditService';
import * as repository from './locations.repository';
import type {
  ConfigureLocationLevelsInput,
  CreateCountryInput,
  CreateLocationInput,
  ListCountriesQueryInput,
  ListLocationLevelsQueryInput,
  ListLocationsQueryInput,
  LocationTreeQueryInput,
  UpdateCountryInput,
  UpdateLocationInput,
} from './locations.validation';

type Actor = {
  id: string;
  roleId?: string | null;
  role?: { name?: string | null } | null;
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const normalizeRoleKey = (role?: string | null): string =>
  (role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');

const resolveDisplayName = (user?: { name?: string | null; username?: string | null; email?: string | null } | null): string | null => {
  if (!user) return null;
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return user.username.trim();
  return user.email || null;
};

const mapCountry = (row: any) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  createdBy: row.createdBy
    ? {
        ...row.createdBy,
        displayName: resolveDisplayName(row.createdBy),
      }
    : null,
  updatedBy: row.updatedBy
    ? {
        ...row.updatedBy,
        displayName: resolveDisplayName(row.updatedBy),
      }
    : null,
});

const mapLevel = (row: any) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  createdBy: row.createdBy
    ? {
        ...row.createdBy,
        displayName: resolveDisplayName(row.createdBy),
      }
    : null,
  updatedBy: row.updatedBy
    ? {
        ...row.updatedBy,
        displayName: resolveDisplayName(row.updatedBy),
      }
    : null,
});

const mapLocation = (row: any) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
});

const ensureModuleReady = async (): Promise<void> => {
  const ready = await repository.ensureLocationSchemaReady();
  if (!ready) {
    throw createServiceError(
      'Locations module is not ready. Required database schema is missing. Run Prisma migration/db push.',
      503,
    );
  }
};

const getPermissionKeys = async (actor: Actor): Promise<string[]> => {
  if (!actor.roleId) return [];
  if (normalizeRoleKey(actor.role?.name) === 'superadmin') return ['*'];
  return repository.getRolePermissionKeys(actor.roleId);
};

const canManageLocations = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return permissions.includes('*') || permissions.includes('LOCATION_MANAGE') || permissions.includes('SYSTEM_CONFIG');
};

const canViewLocations = async (actor: Actor): Promise<boolean> => {
  const permissions = await getPermissionKeys(actor);
  return permissions.includes('*') || permissions.includes('LOCATION_VIEW') || permissions.includes('LOCATION_MANAGE') || permissions.includes('SYSTEM_CONFIG');
};

const assertManageLocations = async (actor: Actor): Promise<void> => {
  if (await canManageLocations(actor)) return;
  throw createServiceError('Access denied. You need location management permissions.', 403);
};

const assertViewLocations = async (actor: Actor): Promise<void> => {
  if (await canViewLocations(actor)) return;
  throw createServiceError('Access denied. You need location view permissions.', 403);
};

const resolveLocationType = (levelName: string, levelOrder: number): LocationType => {
  const normalized = levelName.toLowerCase().trim().replace(/[\s_-]+/g, '');
  if (normalized.includes('country')) return LocationType.COUNTRY;
  if (normalized.includes('state') || normalized.includes('province') || normalized.includes('region')) return LocationType.STATE;
  if (normalized.includes('district') || normalized.includes('county')) return LocationType.DISTRICT;
  if (normalized.includes('city') || normalized.includes('town')) return LocationType.CITY;
  if (normalized.includes('ward') || normalized.includes('zone') || normalized.includes('village')) return LocationType.WARD;
  if (normalized.includes('office') || normalized.includes('branch') || normalized.includes('constituency')) return LocationType.OFFICE;

  if (levelOrder === 1) return LocationType.STATE;
  if (levelOrder === 2) return LocationType.DISTRICT;
  if (levelOrder === 3) return LocationType.CITY;
  if (levelOrder === 4) return LocationType.WARD;
  return LocationType.OFFICE;
};

const getCountryRootLocation = async (workspaceId: string, countryId: string, countryName: string, actorId?: string | null) => {
  const existing = await repository.findCountryRootLocation(workspaceId, countryId);
  if (existing) return existing;

  return repository.createCountryRootLocation({
    workspaceId,
    countryId,
    name: countryName,
    type: LocationType.COUNTRY,
    parentId: null,
    isActive: true,
    createdById: actorId ?? null,
    updatedById: actorId ?? null,
  });
};

export const createCountry = async (
  workspaceId: string,
  actor: Actor,
  input: CreateCountryInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  if (await repository.findCountryByName(workspaceId, input.name.trim())) {
    throw createServiceError(`Country '${input.name.trim()}' already exists.`, 409);
  }

  if (input.code?.trim() && (await repository.findCountryByCode(workspaceId, input.code.trim()))) {
    throw createServiceError(`Country code '${input.code.trim()}' already exists.`, 409);
  }

  const created = await repository.createCountryWithRootLocation(
    {
      workspaceId,
      name: input.name.trim(),
      code: input.code?.trim() || null,
      isActive: input.isActive ?? true,
      createdById: actor.id,
      updatedById: actor.id,
    },
    {
      workspaceId,
      name: input.name.trim(),
      type: LocationType.COUNTRY,
      levelId: undefined,
      parentId: null,
      isActive: input.isActive ?? true,
      createdById: actor.id,
      updatedById: actor.id,
    },
  );

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'COUNTRY_CREATED',
    entityType: 'Country',
    entityId: created.id,
    details: {
      name: created.name,
      code: created.code,
      isActive: created.isActive,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapCountry(created);
};

export const listCountries = async (workspaceId: string, actor: Actor, query: ListCountriesQueryInput) => {
  await ensureModuleReady();
  await assertViewLocations(actor);

  const where: any = {
    workspaceId,
    deletedAt: null,
  };

  if (query.search) {
    where.OR = [
      {
        name: {
          contains: query.search,
          mode: 'insensitive',
        },
      },
      {
        code: {
          contains: query.search,
          mode: 'insensitive',
        },
      },
    ];
  }

  if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  const skip = (query.page - 1) * query.limit;
  const { rows, total } = await repository.listCountries(where, skip, query.limit);

  return {
    data: rows.map(mapCountry),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const updateCountry = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateCountryInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const existing = await repository.findCountryById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Country not found in this workspace.', 404);
  }

  const nextName = input.name?.trim() ?? existing.name;
  const nextCode = input.code?.trim() ?? existing.code;

  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    if (await repository.findCountryByName(workspaceId, nextName, id)) {
      throw createServiceError(`Country '${nextName}' already exists.`, 409);
    }
  }

  if (nextCode && nextCode.toLowerCase() !== (existing.code || '').toLowerCase()) {
    if (await repository.findCountryByCode(workspaceId, nextCode, id)) {
      throw createServiceError(`Country code '${nextCode}' already exists.`, 409);
    }
  }

  const updated = await repository.updateCountry(id, {
    name: nextName,
    code: nextCode || null,
    isActive: input.isActive ?? existing.isActive,
    updatedById: actor.id,
  });

  const rootLocation = await repository.findCountryRootLocation(workspaceId, id);
  if (rootLocation) {
    await repository.updateLocation(rootLocation.id, {
      name: nextName,
      isActive: input.isActive ?? existing.isActive,
      updatedById: actor.id,
    });
  }

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'COUNTRY_UPDATED',
    entityType: 'Country',
    entityId: updated.id,
    details: {
      previousName: existing.name,
      nextName: updated.name,
      previousCode: existing.code,
      nextCode: updated.code,
      previousStatus: existing.isActive,
      nextStatus: updated.isActive,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapCountry(updated);
};

export const deleteCountry = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const existing = await repository.findCountryById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Country not found in this workspace.', 404);
  }

  const activeLocationCount = await repository.countActiveCountryLocations(workspaceId, id);
  if (activeLocationCount > 0) {
    throw createServiceError('Cannot delete this country while active child locations exist.', 409);
  }

  const updated = await repository.updateCountry(id, {
    isActive: false,
    deletedAt: new Date(),
    updatedById: actor.id,
  });

  const rootLocation = await repository.findCountryRootLocation(workspaceId, id);
  if (rootLocation) {
    await repository.updateLocation(rootLocation.id, {
      isActive: false,
      deletedAt: new Date(),
      updatedById: actor.id,
    });
  }

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'COUNTRY_DELETED',
    entityType: 'Country',
    entityId: updated.id,
    details: {
      name: existing.name,
      code: existing.code,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapCountry(updated);
};

export const configureLocationLevels = async (
  workspaceId: string,
  actor: Actor,
  input: ConfigureLocationLevelsInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const country = await repository.findCountryById(workspaceId, input.countryId);
  if (!country) {
    throw createServiceError('Country not found in this workspace.', 404);
  }

  const duplicateOrders = new Set<number>();
  const seenOrders = new Set<number>();
  const duplicateNames = new Set<string>();
  const seenNames = new Set<string>();

  for (const level of input.levels) {
    if (seenOrders.has(level.order)) duplicateOrders.add(level.order);
    seenOrders.add(level.order);

    const normalizedName = level.name.toLowerCase().trim();
    if (seenNames.has(normalizedName)) duplicateNames.add(level.name);
    seenNames.add(normalizedName);
  }

  if (duplicateOrders.size > 0) {
    throw createServiceError(`Duplicate level orders are not allowed: ${Array.from(duplicateOrders).join(', ')}.`, 422);
  }

  if (duplicateNames.size > 0) {
    throw createServiceError(`Duplicate level names are not allowed: ${Array.from(duplicateNames).join(', ')}.`, 422);
  }

  const rows = await repository.configureLocationLevels(
    workspaceId,
    input.countryId,
    actor.id,
    input.levels.map((level) => ({
      name: level.name.trim(),
      order: level.order,
      isActive: level.isActive,
    })),
  );

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOCATION_LEVELS_CONFIGURED',
    entityType: 'Country',
    entityId: input.countryId,
    details: {
      levels: rows.map((row: any) => ({
        id: row.id,
        levelName: row.levelName,
        levelOrder: row.levelOrder,
        isActive: row.isActive,
      })),
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return {
    country: mapCountry(country),
    levels: rows.map(mapLevel),
  };
};

export const listLocationLevels = async (workspaceId: string, actor: Actor, query: ListLocationLevelsQueryInput) => {
  await ensureModuleReady();
  await assertViewLocations(actor);

  if (query.countryId) {
    const country = await repository.findCountryById(workspaceId, query.countryId);
    if (!country) {
      throw createServiceError('Country not found in this workspace.', 404);
    }
  }

  const rows = await repository.listLocationLevels(workspaceId, query.countryId);
  return {
    data: rows.map(mapLevel),
  };
};

export const createLocation = async (
  workspaceId: string,
  actor: Actor,
  input: CreateLocationInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const country = await repository.findCountryById(workspaceId, input.countryId);
  if (!country || !country.isActive) {
    throw createServiceError('Invalid country. Please choose an active country.', 422);
  }

  const level = await repository.findLocationLevelById(workspaceId, input.levelId);
  if (!level || level.countryId !== input.countryId || !level.isActive) {
    throw createServiceError('Invalid location level for the selected country.', 422);
  }

  const countryRoot = await getCountryRootLocation(workspaceId, country.id, country.name, actor.id);

  let resolvedParentId: string | null = input.parentId ?? null;
  if (level.levelOrder === 1) {
    resolvedParentId = countryRoot.id;
  } else {
    if (!resolvedParentId) {
      throw createServiceError(`Parent is required for ${level.levelName}.`, 422);
    }

    const parent = await repository.findLocationById(workspaceId, resolvedParentId);
    if (!parent || parent.countryId !== input.countryId) {
      throw createServiceError('Invalid parent location for the selected country.', 422);
    }

    if (!parent.level || parent.level.levelOrder !== level.levelOrder - 1) {
      throw createServiceError(`Parent must belong to level order ${level.levelOrder - 1}.`, 422);
    }
  }

  if (await repository.findLocationByNameInParent(workspaceId, input.countryId, resolvedParentId, input.name.trim())) {
    throw createServiceError(`Location '${input.name.trim()}' already exists under this parent.`, 409);
  }

  const created = await repository.createLocation({
    workspaceId,
    countryId: input.countryId,
    levelId: input.levelId,
    parentId: resolvedParentId,
    name: input.name.trim(),
    type: resolveLocationType(level.levelName, level.levelOrder),
    isActive: input.isActive ?? true,
    createdById: actor.id,
    updatedById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOCATION_CREATED',
    entityType: 'Location',
    entityId: created.id,
    details: {
      name: created.name,
      countryId: created.countryId,
      levelId: created.levelId,
      parentId: created.parentId,
      type: created.type,
      isActive: created.isActive,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLocation(created);
};

export const updateLocation = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  input: UpdateLocationInput,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const existing = await repository.findLocationById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Location not found in this workspace.', 404);
  }

  if (!existing.countryId) {
    throw createServiceError('Country root locations cannot be updated through this endpoint.', 422);
  }

  let resolvedParentId = input.parentId ?? existing.parentId ?? null;
  if (existing.level?.levelOrder === 1) {
    const country = await repository.findCountryById(workspaceId, existing.countryId);
    if (!country) {
      throw createServiceError('Country not found for this location.', 404);
    }
    const countryRoot = await getCountryRootLocation(workspaceId, existing.countryId, country.name, actor.id);
    resolvedParentId = countryRoot.id;
  } else if (input.parentId) {
    const parent = await repository.findLocationById(workspaceId, input.parentId);
    if (!parent || parent.countryId !== existing.countryId) {
      throw createServiceError('Invalid parent location for the selected country.', 422);
    }

    if (!existing.level || !parent.level || parent.level.levelOrder !== existing.level.levelOrder - 1) {
      throw createServiceError(`Parent must belong to level order ${(existing.level?.levelOrder ?? 1) - 1}.`, 422);
    }
  }

  const nextName = input.name?.trim() ?? existing.name;
  if (await repository.findLocationByNameInParent(workspaceId, existing.countryId, resolvedParentId, nextName, id)) {
    throw createServiceError(`Location '${nextName}' already exists under this parent.`, 409);
  }

  const updated = await repository.updateLocation(id, {
    name: nextName,
    parentId: resolvedParentId,
    isActive: input.isActive ?? existing.isActive,
    updatedById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOCATION_UPDATED',
    entityType: 'Location',
    entityId: updated.id,
    details: {
      previousName: existing.name,
      nextName: updated.name,
      previousParentId: existing.parentId,
      nextParentId: updated.parentId,
      previousStatus: existing.isActive,
      nextStatus: updated.isActive,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLocation(updated);
};

export const deleteLocation = async (
  workspaceId: string,
  actor: Actor,
  id: string,
  context?: { ipAddress?: string; userAgent?: string },
) => {
  await ensureModuleReady();
  await assertManageLocations(actor);

  const existing = await repository.findLocationById(workspaceId, id);
  if (!existing) {
    throw createServiceError('Location not found in this workspace.', 404);
  }

  if (!existing.levelId) {
    throw createServiceError('Country root locations cannot be deleted directly.', 422);
  }

  const childCount = await repository.countLocationChildren(workspaceId, id);
  if (childCount > 0) {
    throw createServiceError('Cannot delete this location while child locations exist.', 409);
  }

  const deleted = await repository.updateLocation(id, {
    isActive: false,
    deletedAt: new Date(),
    updatedById: actor.id,
  });

  await auditService.log({
    userId: actor.id,
    workspaceId,
    action: 'LOCATION_DELETED',
    entityType: 'Location',
    entityId: deleted.id,
    details: {
      name: existing.name,
      countryId: existing.countryId,
      levelId: existing.levelId,
      parentId: existing.parentId,
    },
    ipAddress: context?.ipAddress,
    userAgent: context?.userAgent,
  });

  return mapLocation(deleted);
};

export const listLocations = async (workspaceId: string, actor: Actor, query: ListLocationsQueryInput) => {
  await ensureModuleReady();
  await assertViewLocations(actor);

  const where: any = {
    workspaceId,
    deletedAt: null,
    isActive: true,
  };

  if (query.countryId) {
    const country = await repository.findCountryById(workspaceId, query.countryId);
    if (!country) {
      throw createServiceError('Country not found in this workspace.', 404);
    }
    where.countryId = query.countryId;
  }

  if (query.parentId) {
    where.parentId = query.parentId;
  }

  if (query.levelOrder !== undefined) {
    if (!query.countryId) {
      throw createServiceError('countryId is required when filtering by levelOrder.', 422);
    }

    const level = await repository.findLocationLevelByOrder(workspaceId, query.countryId, query.levelOrder);
    if (!level) {
      return { data: [] };
    }
    where.levelId = level.id;
  }

  const rows = await repository.listLocations(where);
  return {
    data: rows.map(mapLocation),
  };
};

export const getLocationTree = async (workspaceId: string, actor: Actor, query: LocationTreeQueryInput) => {
  await ensureModuleReady();
  await assertViewLocations(actor);

  const country = await repository.findCountryById(workspaceId, query.countryId);
  if (!country) {
    throw createServiceError('Country not found in this workspace.', 404);
  }

  const rows = await repository.listLocations({
    workspaceId,
    countryId: query.countryId,
    deletedAt: null,
  });

  const root = await getCountryRootLocation(workspaceId, query.countryId, country.name);
  const mappedRows = rows.map(mapLocation);
  const rowMap = new Map<string, any>();

  for (const row of mappedRows) {
    rowMap.set(row.id, {
      ...row,
      children: [],
    });
  }

  const tree: any[] = [];
  for (const row of rowMap.values()) {
    if (row.id === root.id) continue;

    if (row.parentId && rowMap.has(row.parentId) && row.parentId !== root.id) {
      rowMap.get(row.parentId).children.push(row);
      continue;
    }

    tree.push(row);
  }

  return {
    country: mapCountry(country),
    root: mapLocation(root),
    tree,
  };
};
