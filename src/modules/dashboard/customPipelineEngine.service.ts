import { Prisma } from '@prisma/client';

export interface FilterCondition {
  field: string;
  operator: string;
  value?: any;
}

const buildSingleConditionWhere = (condition: FilterCondition): Prisma.LeadWhereInput | null => {
  const { field, operator, value } = condition;
  if (!field || !operator) return null;

  // Unary operators that do not require a value
  const isUnaryOperator = [
    'IS_EMPTY',
    'IS_NOT_EMPTY',
    'TODAY',
    'YESTERDAY',
    'TOMORROW',
    'THIS_WEEK',
    'LAST_WEEK',
    'THIS_MONTH',
    'LAST_MONTH',
    'THIS_QUARTER',
    'THIS_YEAR',
  ].includes(operator);

  // Skip non-unary filters with blank / empty values to avoid matching 0 records
  if (!isUnaryOperator) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      return null;
    }
  }

  // 1. Dynamic Lead Fields (e.g. "dynamic_clx123...")
  if (field.startsWith('dynamic_')) {
    const fieldId = field.replace('dynamic_', '');
    const stringVal = value !== undefined && value !== null ? String(value) : '';

    if (operator === 'EQUALS') {
      return { dynamicValues: { some: { fieldId, value: stringVal } } };
    }
    if (operator === 'NOT_EQUALS') {
      return { NOT: { dynamicValues: { some: { fieldId, value: stringVal } } } };
    }
    if (operator === 'CONTAINS') {
      return { dynamicValues: { some: { fieldId, value: { contains: stringVal, mode: 'insensitive' } } } };
    }
    if (operator === 'IS_EMPTY') {
      return { NOT: { dynamicValues: { some: { fieldId } } } };
    }
    if (operator === 'IS_NOT_EMPTY') {
      return { dynamicValues: { some: { fieldId } } };
    }
    return { dynamicValues: { some: { fieldId, value: stringVal } } };
  }

  // 2. Date Fields
  const isDateField = [
    'createdAt',
    'updatedAt',
    'closedAt',
    'nextFollowUpAt',
    'stageEnteredAt',
    'stageExpiresAt',
    'pendingApprovalRequestedAt',
  ].includes(field);

  if (isDateField) {
    const dateWhere = buildDateConditionWhere(operator, value);
    if (!dateWhere) return null;
    return { [field]: dateWhere };
  }

  // 3. Status Presets
  if (field === 'leadStatus') {
    if (value === 'OPEN') return { isClosed: false };
    if (value === 'CLOSED') return { isClosed: true, isLOB: false };
    if (value === 'LOB') return { isLOB: true };
    if (value === 'ACTIVE') return { isClosed: false, isLOB: false };
    if (value === 'ARCHIVED') return { deletedAt: { not: null } };
  }

  // 4. Boolean Fields
  if (field === 'isClosed' || field === 'isLOB') {
    const boolVal = operator === 'YES' || value === true || value === 'true';
    return { [field]: boolVal };
  }

  // 5. Office & Department Scoping via Assigned User
  if (field === 'officeId') {
    if (operator === 'IS_ANY_OF' && Array.isArray(value)) {
      return { assignedTo: { officeId: { in: value } } };
    }
    if (operator === 'NOT_EQUALS') {
      return { assignedTo: { officeId: { not: value } } };
    }
    return { assignedTo: { officeId: value } };
  }

  if (field === 'departmentId') {
    if (operator === 'IS_ANY_OF' && Array.isArray(value)) {
      return { assignedTo: { departmentId: { in: value } } };
    }
    if (operator === 'NOT_EQUALS') {
      return { assignedTo: { departmentId: { not: value } } };
    }
    return { assignedTo: { departmentId: value } };
  }

  if (field === 'supervisorId') {
    return { assignedTo: { supervisorId: value } };
  }

  // 6. Number & Currency Fields
  const isNumberField = ['expectedRevenue', 'generatedRevenue', 'totalAmount', 'earnedRevenue'].includes(field);
  if (isNumberField) {
    const numVal = Number(value);
    if (operator === 'EQUALS') return { [field]: numVal };
    if (operator === 'NOT_EQUALS') return { [field]: { not: numVal } };
    if (operator === 'GREATER_THAN') return { [field]: { gt: numVal } };
    if (operator === 'GREATER_THAN_OR_EQUAL') return { [field]: { gte: numVal } };
    if (operator === 'LESS_THAN') return { [field]: { lt: numVal } };
    if (operator === 'LESS_THAN_OR_EQUAL') return { [field]: { lte: numVal } };
    if (operator === 'IN_RANGE' && typeof value === 'object' && value !== null) {
      return { [field]: { gte: Number(value.min || 0), lte: Number(value.max || 999999999) } };
    }
    if ((operator === 'NOT_IN_RANGE' || operator === 'NOT_BETWEEN') && typeof value === 'object' && value !== null) {
      return { OR: [{ [field]: { lt: Number(value.min || 0) } }, { [field]: { gt: Number(value.max || 999999999) } }] };
    }
    if (operator === 'IS_EMPTY') return { [field]: null };
    if (operator === 'IS_NOT_EMPTY') return { [field]: { not: null } };
    return null;
  }

  // 7. Select & ID Fields (e.g. stageId, substageId, sourceId, lifecycleId, assignedToId)
  if (['stageId', 'substageId', 'sourceId', 'lifecycleId', 'assignedToId', 'createdById'].includes(field)) {
    if (operator === 'EQUALS') return { [field]: value };
    if (operator === 'NOT_EQUALS') return { [field]: { not: value } };
    if (operator === 'IS_ANY_OF' && Array.isArray(value)) return { [field]: { in: value } };
    if (operator === 'IS_NONE_OF' && Array.isArray(value)) return { [field]: { notIn: value } };
    if (operator === 'IS_EMPTY') return { [field]: null };
    if (operator === 'IS_NOT_EMPTY') return { [field]: { not: null } };
    return null;
  }

  // 8. Text Fields (name, phone, email, companyName, address)
  const strVal = String(value || '').trim();
  if (operator === 'EQUALS') return { [field]: { equals: strVal, mode: 'insensitive' } };
  if (operator === 'NOT_EQUALS') return { NOT: { [field]: { equals: strVal, mode: 'insensitive' } } };
  if (operator === 'CONTAINS') return { [field]: { contains: strVal, mode: 'insensitive' } };
  if (operator === 'NOT_CONTAINS') return { NOT: { [field]: { contains: strVal, mode: 'insensitive' } } };
  if (operator === 'STARTS_WITH') return { [field]: { startsWith: strVal, mode: 'insensitive' } };
  if (operator === 'ENDS_WITH') return { [field]: { endsWith: strVal, mode: 'insensitive' } };
  if (operator === 'IS_EMPTY') return { OR: [{ [field]: null }, { [field]: '' }] };
  if (operator === 'IS_NOT_EMPTY') return { AND: [{ [field]: { not: null } }, { [field]: { not: '' } }] };

  return null;
};

const buildDateConditionWhere = (operator: string, value: any): Prisma.DateTimeFilter | null => {
  const now = new Date();

  const getDayRange = (d: Date) => {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start, end };
  };

  if (operator === 'TODAY') {
    const { start, end } = getDayRange(now);
    return { gte: start, lte: end };
  }

  if (operator === 'YESTERDAY') {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const { start, end } = getDayRange(yesterday);
    return { gte: start, lte: end };
  }

  if (operator === 'TOMORROW') {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { start, end } = getDayRange(tomorrow);
    return { gte: start, lte: end };
  }

  if (operator === 'THIS_WEEK') {
    const day = now.getDay();
    const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diffToMonday));
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const end = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'LAST_WEEK') {
    const day = now.getDay();
    const diffToLastMonday = now.getDate() - day + (day === 0 ? -6 : 1) - 7;
    const monday = new Date(now.setDate(diffToLastMonday));
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    const end = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'THIS_MONTH') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'LAST_MONTH') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'THIS_QUARTER') {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), currentQuarter * 3, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), currentQuarter * 3 + 3, 0, 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'THIS_YEAR') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { gte: start, lte: end };
  }

  if (operator === 'LAST_N_DAYS') {
    const days = Number(value || 7);
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { gte: start, lte: now };
  }

  if (operator === 'NEXT_N_DAYS' || operator === 'WITHIN_NEXT_N_DAYS') {
    const days = Number(value || 7);
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return { gte: now, lte: end };
  }

  if (operator === 'OLDER_THAN_N_DAYS') {
    const days = Number(value || 30);
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { lt: cutoff };
  }

  if (operator === 'LAST_N_WEEKS') {
    const weeks = Number(value || 1);
    const start = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    return { gte: start, lte: now };
  }

  if (operator === 'NEXT_N_WEEKS') {
    const weeks = Number(value || 1);
    const end = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    return { gte: now, lte: end };
  }

  if (operator === 'LAST_N_MONTHS') {
    const months = Number(value || 1);
    const start = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
    return { gte: start, lte: now };
  }

  if (operator === 'NEXT_N_MONTHS') {
    const months = Number(value || 1);
    const end = new Date(now.getFullYear(), now.getMonth() + months, now.getDate());
    return { gte: now, lte: end };
  }

  if (operator === 'GREATER_THAN' || operator === 'AFTER') {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return { gt: parsed };
  }

  if (operator === 'LESS_THAN' || operator === 'BEFORE') {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return { lt: parsed };
  }

  if (operator === 'EQUALS') {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    const { start, end } = getDayRange(d);
    return { gte: start, lte: end };
  }

  if (operator === 'IN_RANGE' || operator === 'BETWEEN') {
    let fromDate: Date | undefined = undefined;
    let toDate: Date | undefined = undefined;

    if (typeof value === 'object' && value !== null) {
      if (value.from) {
        const f = new Date(`${value.from}T00:00:00.000Z`);
        if (!isNaN(f.getTime())) fromDate = f;
      }
      if (value.to) {
        const t = new Date(`${value.to}T23:59:59.999Z`);
        if (!isNaN(t.getTime())) toDate = t;
      }
    } else if (typeof value === 'string' && value.includes(',')) {
      const parts = value.split(',');
      if (parts[0]) {
        const f = new Date(parts[0].trim());
        if (!isNaN(f.getTime())) fromDate = f;
      }
      if (parts[1]) {
        const t = new Date(parts[1].trim());
        if (!isNaN(t.getTime())) toDate = t;
      }
    }

    if (fromDate || toDate) return { gte: fromDate, lte: toDate };
  }

  if (operator === 'IS_EMPTY') return { equals: null as any };
  if (operator === 'IS_NOT_EMPTY') return { not: null as any };

  return null;
};

export const buildCustomPipelineWhere = (
  filtersJson: FilterCondition[],
  filterLogic: 'AND' | 'OR' = 'AND',
  leadAccessScope?: Prisma.LeadWhereInput,
): Prisma.LeadWhereInput => {
  const safeFilters = Array.isArray(filtersJson) ? filtersJson : [];
  const conditionWheres: Prisma.LeadWhereInput[] = [];

  for (const cond of safeFilters) {
    try {
      const singleWhere = buildSingleConditionWhere(cond);
      if (singleWhere) {
        conditionWheres.push(singleWhere);
      }
    } catch (err) {
      // Safe fallback for malformed condition
    }
  }

  let combinedFilter: Prisma.LeadWhereInput = {};
  if (conditionWheres.length > 0) {
    if (filterLogic === 'OR') {
      combinedFilter = { OR: conditionWheres };
    } else {
      combinedFilter = { AND: conditionWheres };
    }
  }

  if (leadAccessScope && Object.keys(leadAccessScope).length > 0) {
    return { AND: [leadAccessScope, combinedFilter] };
  }

  return combinedFilter;
};
