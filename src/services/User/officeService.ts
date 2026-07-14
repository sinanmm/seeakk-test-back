import prisma from '../../config/prisma';
import logger from '../../utils/logger';
import type {
  CreateOfficeInput,
  ListOfficesQuery,
  ToggleOfficeStatusInput,
  UpdateOfficeInput,
} from '../../validations/officeValidation';

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const validateLocationHierarchy = async (
  workspaceId: string,
  countryId: string,
  stateId: string,
  districtId: string,
): Promise<void> => {
  const [country, strictState, strictDistrict] = await prisma.$transaction([
    (prisma as any).location.findFirst({
      where: { id: countryId, workspaceId, type: 'COUNTRY', deletedAt: null, isActive: true },
      select: { id: true },
    }),
    (prisma as any).location.findFirst({
      where: { id: stateId, workspaceId, deletedAt: null, isActive: true },
      select: { id: true, parentId: true, countryId: true, type: true, level: { select: { levelOrder: true } } },
    }),
    (prisma as any).location.findFirst({
      where: { id: districtId, workspaceId, deletedAt: null, isActive: true },
      select: { id: true, parentId: true, countryId: true },
    }),
  ]);

  const state =
    strictState ||
    (await (prisma as any).location.findFirst({
      where: { id: stateId, workspaceId },
      select: { id: true, parentId: true, countryId: true, type: true, level: { select: { levelOrder: true } } },
    }));

  const district =
    strictDistrict ||
    (await (prisma as any).location.findFirst({
      where: { id: districtId, workspaceId },
      select: { id: true, parentId: true, countryId: true },
    }));

  if (!country) {
    throw createServiceError('Country not found in this workspace.', 400);
  }
  if (!state) {
    throw createServiceError('Level 1 location not found in this workspace.', 400);
  }
  if (!district) {
    throw createServiceError('Deepest location not found in this workspace.', 400);
  }

  const isFirstLevel =
    (state.type === 'STATE' || state.level?.levelOrder === 1) &&
    (state.parentId === country.id ||
      // Legacy fallback: some historical location rows were stored without parent linkage.
      (state.parentId == null && state.countryId === country.id));
  if (!isFirstLevel) {
    throw createServiceError('Invalid location hierarchy: level 1 location must belong to selected country.', 400);
  }

  if (district.id === state.id) {
    return;
  }

  let cursorId: string | null = district.parentId || null;
  let guard = 0;
  while (cursorId && guard < 12) {
    if (cursorId === state.id) return;
    const parent = await (prisma as any).location.findFirst({
      where: { id: cursorId, workspaceId, deletedAt: null },
      select: { id: true, parentId: true },
    });
    cursorId = parent?.parentId || null;
    guard += 1;
  }

  if (
    cursorId !== state.id &&
    district.parentId == null &&
    district.countryId === country.id &&
    state.countryId === country.id
  ) {
    // Legacy fallback for rows missing parent chain but correctly scoped to the same country.
    return;
  }

  if (cursorId !== state.id) {
    throw createServiceError('Invalid location hierarchy: deepest location does not belong to level 1 location.', 400);
  }
};

const ensureOfficeNameUnique = async (
  workspaceId: string,
  name: string,
  excludeId?: string,
): Promise<void> => {
  const existing = await (prisma as any).office.findFirst({
    where: {
      workspaceId,
      name: { equals: name},
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw createServiceError(`Office "${name}" already exists in this workspace.`, 409);
  }
};

export const createOffice = async (
  workspaceId: string,
  input: CreateOfficeInput,
  createdBy?: string,
) => {
  await ensureOfficeNameUnique(workspaceId, input.name);

  const office = await (prisma as any).office.create({
    data: {
      name: input.name,
      address: input.address ?? null,
      country: input.country,
      state: input.state,
      district: input.district ?? null,
      city: input.city,
      workspaceId,
      createdBy: createdBy ?? null,
      isActive: true,
    },
  });

  logger.info('Office created', {
    officeId: office.id,
    workspaceId,
    createdBy: createdBy ?? null,
  });

  return office;
};

export const listOffices = async (workspaceId: string, query?: ListOfficesQuery) => {
  if (!query) {
    const offices = await (prisma as any).office.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { name: 'asc' },
    });
    return {
      offices,
      pagination: {
        page: 1,
        limit: offices.length || 10,
        total: offices.length,
        totalPages: 1,
      },
    };
  }

  const { page, limit, search, status, country, state, district, city } = query;
  const skip = (page - 1) * limit;

  const where: any = {
    workspaceId,
    ...(status ? { isActive: status === 'ACTIVE' } : { isActive: true }),
    ...(search
      ? {
          name: { contains: search, mode: 'insensitive'},
        }
      : {}),
    ...(country ? { country } : {}),
    ...(state ? { state } : {}),
    ...(district ? { district } : {}),
    ...(city ? { city } : {}),
  };

  const [total, offices] = await prisma.$transaction([
    (prisma as any).office.count({ where }),
    (prisma as any).office.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
    }),
  ]);

  return {
    offices,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getOfficeById = async (id: string, workspaceId: string) => {
  const office = await (prisma as any).office.findFirst({
    where: { id, workspaceId },
  });

  if (!office) {
    throw createServiceError('Office not found in this workspace.', 404);
  }

  return office;
};

export const updateOffice = async (
  workspaceId: string,
  id: string,
  input: UpdateOfficeInput,
) => {
  const existing = await (prisma as any).office.findFirst({
    where: { id, workspaceId },
  });

  if (!existing) {
    throw createServiceError('Office not found.', 404);
  }

  if (input.name && input.name !== existing.name) {
    await ensureOfficeNameUnique(workspaceId, input.name, id);
  }

  const updatedOffice = await (prisma as any).office.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.state !== undefined ? { state: input.state } : {}),
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.city !== undefined ? { city: input.city } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  logger.info('Office updated', { officeId: id, workspaceId, updatedFields: Object.keys(input) });

  return updatedOffice;
};

export const deleteOffice = async (id: string, workspaceId: string) => {
  const existing = await (prisma as any).office.findFirst({
    where: { id, workspaceId },
  });

  if (!existing) {
    throw createServiceError('Office not found in this workspace.', 404);
  }

  const assignedUsers = await (prisma as any).user.count({
    where: { workspaceId, officeId: id, deletedAt: null },
  });

  if (assignedUsers > 0) {
    throw createServiceError('Office is assigned to users and cannot be deleted.', 400);
  }

  await (prisma as any).office.update({
    where: { id },
    data: { isActive: false },
  });

  logger.info('Office soft deleted (set inactive)', { officeId: id, workspaceId });
};

export const toggleOfficeStatus = async (
  id: string,
  workspaceId: string,
  input: ToggleOfficeStatusInput,
) => {
  const office = await (prisma as any).office.findFirst({
    where: { id, workspaceId },
  });

  if (!office) {
    throw createServiceError('Office not found in this workspace.', 404);
  }

  const updated = await (prisma as any).office.update({
    where: { id },
    data: { isActive: input.isActive },
  });

  logger.info('Office status toggled', { officeId: id, workspaceId, isActive: input.isActive });

  return updated;
};
