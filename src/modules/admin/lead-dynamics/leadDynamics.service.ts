import prisma from '../../../config/prisma';
import {
  CreateLeadDynamicFieldInput,
  ListLeadDynamicFieldsQuery,
  SaveLeadDynamicValuesInput,
  UpdateLeadDynamicFieldInput,
} from './leadDynamics.validation';
import {
  LeadDynamicFieldResponse,
  LeadDynamicInputType,
  LeadDynamicValueResponse,
  ListLeadDynamicFieldsResponse,
} from './leadDynamics.types';

const OPTION_INPUT_TYPES = new Set<LeadDynamicInputType>(['SELECT', 'RADIO', 'CHECKBOX']);

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const createServiceError = (message: string, statusCode: number): Error & { statusCode: number } => {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
};

const hasGeneratedDelegates = (): boolean => {
  const field = (prisma as any).leadDynamicField;
  const option = (prisma as any).leadDynamicOption;
  const value = (prisma as any).leadDynamicValue;
  return Boolean(
    field?.findFirst &&
      field?.findMany &&
      field?.updateMany &&
      option?.createMany &&
      value?.count &&
      value?.createMany,
  );
};

const assertModuleReady = async (): Promise<void> => {
  const fieldTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE() AND table_name = 'lead_dynamic_fields'
  `;
  const optionTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE() AND table_name = 'lead_dynamic_options'
  `;
  const valueTable = await prisma.$queryRaw<Array<{ table_name: string | null }>>`
    SELECT TABLE_NAME AS table_name 
    FROM information_schema.tables 
    WHERE table_schema = DATABASE() AND table_name = 'lead_dynamic_values'
  `;

  if (!fieldTable[0]?.table_name || !optionTable[0]?.table_name || !valueTable[0]?.table_name) {
    throw createServiceError(
      'Lead Dynamics DB schema is missing. Run Prisma migration/db push and restart backend.',
      503,
    );
  }

  if (!hasGeneratedDelegates()) {
    throw createServiceError(
      'Lead Dynamics module is not ready. Prisma client/schema is stale. Run Prisma migration and prisma generate, then restart backend.',
      503,
    );
  }
};

const isOptionType = (inputType: LeadDynamicInputType): boolean => OPTION_INPUT_TYPES.has(inputType);

type OptionPayload = { value: string; sortOrder: number };

const normalizeOptions = (options: OptionPayload[]): OptionPayload[] => {
  const sorted = [...options].sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value));
  return sorted.map((option, index) => ({
    value: option.value.trim(),
    sortOrder: index + 1,
  }));
};

const validateOptionsByInputType = (inputType: LeadDynamicInputType, options: OptionPayload[]): OptionPayload[] => {
  const normalizedOptions = normalizeOptions(options);

  if (isOptionType(inputType) && normalizedOptions.length === 0) {
    throw createServiceError(`Options are required for ${inputType}.`, 422);
  }

  if (!isOptionType(inputType) && normalizedOptions.length > 0) {
    throw createServiceError(`Options are not allowed for ${inputType}.`, 422);
  }

  const seenOptionValues = new Set<string>();
  for (const option of normalizedOptions) {
    const key = option.value.toLowerCase();
    if (seenOptionValues.has(key)) {
      throw createServiceError(`Duplicate option value "${option.value}" is not allowed.`, 422);
    }
    seenOptionValues.add(key);
  }

  return normalizedOptions;
};

const ensureUniqueName = async (workspaceId: string, name: string, excludeId?: string): Promise<void> => {
  const existing = await (prisma as any).leadDynamicField.findFirst({
    where: {
      workspaceId,
      name,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (existing) {
    throw createServiceError(`Field "${name}" already exists.`, 409);
  }
};

const shiftSortOrderForCreate = async (tx: any, workspaceId: string, sortOrder: number): Promise<void> => {
  await (tx as any).leadDynamicField.updateMany({
    where: {
      workspaceId,
      sortOrder: { gte: sortOrder },
    },
    data: {
      sortOrder: { increment: 1 },
    },
  });
};

const shiftSortOrderForUpdate = async (
  tx: any,
  workspaceId: string,
  fieldId: string,
  oldSortOrder: number,
  newSortOrder: number,
): Promise<void> => {
  if (oldSortOrder === newSortOrder) return;

  if (newSortOrder > oldSortOrder) {
    await (tx as any).leadDynamicField.updateMany({
      where: {
        workspaceId,
        id: { not: fieldId },
        sortOrder: { gt: oldSortOrder, lte: newSortOrder },
      },
      data: {
        sortOrder: { decrement: 1 },
      },
    });
    return;
  }

  await (tx as any).leadDynamicField.updateMany({
    where: {
      workspaceId,
      id: { not: fieldId },
      sortOrder: { gte: newSortOrder, lt: oldSortOrder },
    },
    data: {
      sortOrder: { increment: 1 },
    },
  });
};

export const createLeadDynamicField = async (
  workspaceId: string,
  input: CreateLeadDynamicFieldInput,
): Promise<LeadDynamicFieldResponse> => {
  await assertModuleReady();
  await ensureUniqueName(workspaceId, input.name);
  const options = validateOptionsByInputType(input.inputType, input.options);

  const created = await prisma.$transaction(async (tx: any) => {
    await shiftSortOrderForCreate(tx, workspaceId, input.sortOrder);

    const field = await (tx as any).leadDynamicField.create({
      data: {
        name: input.name,
        inputType: input.inputType,
        sortOrder: input.sortOrder,
        isRequired: input.isRequired,
        isActive: input.isActive,
        workspaceId,
      },
    });

    if (options.length > 0) {
      await (tx as any).leadDynamicOption.createMany({
        data: options.map((option) => ({
          fieldId: field.id,
          value: option.value,
          sortOrder: option.sortOrder,
        })),
      });
    }

    return (tx as any).leadDynamicField.findUnique({
      where: { id: field.id },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  });

  if (!created) {
    throw createServiceError('Failed to create lead dynamic field.', 500);
  }

  return created as LeadDynamicFieldResponse;
};

export const listLeadDynamicFields = async (
  workspaceId: string,
  query: ListLeadDynamicFieldsQuery,
): Promise<ListLeadDynamicFieldsResponse> => {
  await assertModuleReady();

  const { page, limit, search, isActive, inputType } = query;
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    ...(search ? { name: { contains: search} } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(inputType ? { inputType } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    (prisma as any).leadDynamicField.count({ where }),
    (prisma as any).leadDynamicField.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    }),
  ]);

  return {
    fields: rows as LeadDynamicFieldResponse[],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const getLeadDynamicActiveFields = async (workspaceId: string): Promise<LeadDynamicFieldResponse[]> => {
  await assertModuleReady();

  const rows = await (prisma as any).leadDynamicField.findMany({
    where: {
      workspaceId,
      isActive: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      options: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  return rows as LeadDynamicFieldResponse[];
};

export const updateLeadDynamicField = async (
  id: string,
  workspaceId: string,
  input: UpdateLeadDynamicFieldInput,
): Promise<LeadDynamicFieldResponse> => {
  await assertModuleReady();

  const existing = await (prisma as any).leadDynamicField.findFirst({
    where: { id, workspaceId },
    include: {
      options: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  });

  if (!existing) {
    throw createServiceError('Lead dynamic field not found.', 404);
  }

  const nextName = input.name ?? existing.name;
  await ensureUniqueName(workspaceId, nextName, id);

  const nextInputType = (input.inputType ?? existing.inputType) as LeadDynamicInputType;
  const nextSortOrder = input.sortOrder ?? existing.sortOrder;

  const sourceOptions =
    input.options !== undefined
      ? input.options
      : existing.options.map((option: { value: string; sortOrder: number }) => ({
          value: option.value,
          sortOrder: option.sortOrder,
        }));
  const nextOptions = validateOptionsByInputType(nextInputType, sourceOptions);

  const updated = await prisma.$transaction(async (tx: any) => {
    await shiftSortOrderForUpdate(tx, workspaceId, id, existing.sortOrder, nextSortOrder);

    await (tx as any).leadDynamicField.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.inputType !== undefined ? { inputType: input.inputType } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await (tx as any).leadDynamicOption.deleteMany({ where: { fieldId: id } });
    if (nextOptions.length > 0) {
      await (tx as any).leadDynamicOption.createMany({
        data: nextOptions.map((option) => ({
          fieldId: id,
          value: option.value,
          sortOrder: option.sortOrder,
        })),
      });
    }

    return (tx as any).leadDynamicField.findUnique({
      where: { id },
      include: {
        options: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  });

  if (!updated) {
    throw createServiceError('Lead dynamic field not found.', 404);
  }

  return updated as LeadDynamicFieldResponse;
};

export const deleteLeadDynamicField = async (id: string, workspaceId: string): Promise<void> => {
  await assertModuleReady();

  const existing = await (prisma as any).leadDynamicField.findFirst({
    where: { id, workspaceId },
    select: { id: true, sortOrder: true },
  });

  if (!existing) {
    throw createServiceError('Lead dynamic field not found.', 404);
  }

  const usageCountRows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*) AS count
    FROM lead_dynamic_values ldv
    INNER JOIN leads l
      ON l.id = ldv.leadId
    WHERE ldv.fieldId = ${id}
      AND l.workspaceId = ${workspaceId}
      AND l.deletedAt IS NULL
  `;

  const usageCount = Number(usageCountRows[0]?.count ?? 0);

  if (usageCount > 0) {
    throw createServiceError('Field is used in leads and cannot be deleted.', 400);
  }

  await prisma.$transaction(async (tx: any) => {
    await (tx as any).leadDynamicValue.deleteMany({
      where: {
        fieldId: id,
      },
    });

    await (tx as any).leadDynamicField.delete({ where: { id } });
    await (tx as any).leadDynamicField.updateMany({
      where: {
        workspaceId,
        sortOrder: { gt: existing.sortOrder },
      },
      data: {
        sortOrder: { decrement: 1 },
      },
    });
  });
};

export const saveLeadDynamicValues = async (
  workspaceId: string,
  leadId: string,
  input: SaveLeadDynamicValuesInput,
): Promise<LeadDynamicValueResponse[]> => {
  await assertModuleReady();

  const trimmedLeadId = leadId.trim();
  if (!trimmedLeadId) {
    throw createServiceError('Lead id is required.', 422);
  }

  const fieldIds = input.values.map((entry) => entry.fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) {
    throw createServiceError('Duplicate fieldId entries are not allowed in values payload.', 422);
  }

  const fields = await (prisma as any).leadDynamicField.findMany({
    where: {
      workspaceId,
      isActive: true,
      id: { in: fieldIds },
    },
    include: {
      options: true,
    },
  });

  if (fields.length !== fieldIds.length) {
    throw createServiceError('One or more dynamic fields are invalid or inactive.', 422);
  }

  const fieldById = new Map<string, any>();
  fields.forEach((field: any) => fieldById.set(field.id, field));

  for (const entry of input.values) {
    const field = fieldById.get(entry.fieldId);
    const value = entry.value.trim();

    if (field.isRequired && !value) {
      throw createServiceError(`Field "${field.name}" is required.`, 422);
    }

    if (OPTION_INPUT_TYPES.has(field.inputType as LeadDynamicInputType)) {
      const allowed = new Set(
        (field.options as Array<{ value: string }>).map((option) => option.value),
      );
      if (!allowed.has(value)) {
        throw createServiceError(
          `Invalid value "${value}" for field "${field.name}".`,
          422,
        );
      }
    }

    if (field.inputType === 'FILE' && !isHttpUrl(value)) {
      throw createServiceError(
        `Field "${field.name}" expects a valid uploaded file URL.`,
        422,
      );
    }
  }

  const records = await prisma.$transaction(async (tx: any) => {
    await (tx as any).leadDynamicValue.deleteMany({
      where: {
        leadId: trimmedLeadId,
        fieldId: { in: fieldIds },
      },
    });

    await (tx as any).leadDynamicValue.createMany({
      data: input.values.map((entry) => ({
        leadId: trimmedLeadId,
        fieldId: entry.fieldId,
        value: entry.value.trim(),
      })),
    });

    return (tx as any).leadDynamicValue.findMany({
      where: {
        leadId: trimmedLeadId,
        fieldId: { in: fieldIds },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  return records as LeadDynamicValueResponse[];
};
