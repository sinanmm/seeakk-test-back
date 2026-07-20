import ExcelJS from 'exceljs';
import prisma from '../../config/prisma';
import { exportLeads as exportLeadCsv } from '../../services/User/leadService';
import type {
  CreateFromLeadExportInput,
  CreateSheetInput,
  DuplicateSheetInput,
  ListSheetsQuery,
  SheetRowsQuery,
  SyncSheetInput,
  UpdateSheetInput,
} from './sheets.validation';

type Actor = { id: string; roleId?: string | null; role?: { name?: string | null } | null };

type SheetColumn = {
  id: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'dropdown' | 'checkbox' | 'formula';
  width?: number;
  hidden?: boolean;
  sourceField?: string;
  leadFieldKey?: string | null;
};

type SheetRow = {
  id: string;
  cells: Record<string, unknown>;
  metadata?: {
    leadId?: string | null;
    leadName?: string | null;
    leadNumber?: string | null;
  };
};

const LEAD_FIELD_ALIASES: Record<string, string> = {
  name: 'name',
  'lead name': 'name',
  companyname: 'companyName',
  'company name': 'companyName',
  phone: 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  email: 'email',
  address: 'address',
  stage: 'stage',
  'current lead stage': 'stage',
  assigneduser: 'assignedUser',
  'assigned user': 'assignedUser',
  reportingoffice: 'reportingOffice',
  'reporting office': 'reportingOffice',
  source: 'source',
  'lead source': 'source',
  expectedrevenue: 'expectedRevenue',
  'expected revenue contribution': 'expectedRevenue',
  totalamount: 'totalAmount',
  'total amount': 'totalAmount',
  nextfollowupat: 'nextFollowUpAt',
  'next follow up at': 'nextFollowUpAt',
  remarks: 'remarks',
  lastremark: 'lastRemark',
  'last remark': 'lastRemark',
};

const normalizeKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const slug = (value: unknown, fallback: string) => {
  const normalized = normalizeKey(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
};

const inferType = (values: unknown[]): SheetColumn['type'] => {
  const sample = values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 50);
  if (sample.length === 0) return 'text';
  if (sample.every((value) => /^(true|false|yes|no)$/i.test(value))) return 'checkbox';
  if (sample.every((value) => !Number.isNaN(Number(value.replace(/,/g, ''))))) return 'number';
  if (sample.every((value) => !Number.isNaN(Date.parse(value)))) return 'date';
  return 'text';
};

const serialize = (sheet: any) => ({
  ...sheet,
  rowCount: Array.isArray(sheet.rows) ? sheet.rows.length : 0,
  columnCount: Array.isArray(sheet.columns) ? sheet.columns.length : 0,
});

const createVersion = async (sheet: any, actorId?: string | null) => {
  const latest = await (prisma as any).sheetVersion.findFirst({
    where: { sheetId: sheet.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  return (prisma as any).sheetVersion.create({
    data: {
      sheetId: sheet.id,
      workspaceId: sheet.workspaceId,
      version: (latest?.version || 0) + 1,
      name: sheet.name,
      columns: sheet.columns,
      rows: sheet.rows,
      formatting: sheet.formatting || {},
      metadata: sheet.metadata || {},
      createdById: actorId || null,
    },
  });
};

const buildColumnsAndRows = (records: Record<string, unknown>[]) => {
  const headers = Array.from(
    records.reduce((set, record) => {
      Object.keys(record).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  const columns: SheetColumn[] = headers.map((header, index) => {
    const sourceField = String(header || `Column ${index + 1}`);
    const key = slug(sourceField, `column_${index + 1}`);
    const alias = LEAD_FIELD_ALIASES[normalizeKey(sourceField)] || LEAD_FIELD_ALIASES[key] || null;
    return {
      id: key,
      label: sourceField,
      type: alias === 'stage' ? 'dropdown' : inferType(records.map((row) => row[sourceField])),
      width: Math.max(140, Math.min(320, sourceField.length * 12 + 44)),
      sourceField,
      leadFieldKey: alias,
    };
  });

  const leadIdColumn = columns.find((column) => normalizeKey(column.label) === 'lead id');
  const leadNameColumn = columns.find((column) => column.leadFieldKey === 'name');
  const leadNumberColumn = columns.find((column) => normalizeKey(column.label).includes('lead number'));

  const rows: SheetRow[] = records.map((record, rowIndex) => {
    const cells = columns.reduce<Record<string, unknown>>((acc, column) => {
      acc[column.id] = record[column.sourceField || column.label] ?? '';
      return acc;
    }, {});

    return {
      id: `row_${rowIndex + 1}`,
      cells,
      metadata: {
        leadId: leadIdColumn ? String(cells[leadIdColumn.id] || '').trim() || null : null,
        leadName: leadNameColumn ? String(cells[leadNameColumn.id] || '').trim() || null : null,
        leadNumber: leadNumberColumn ? String(cells[leadNumberColumn.id] || '').trim() || null : null,
      },
    };
  });

  return { columns, rows };
};

const enrichRowsWithLeadLinks = async (workspaceId: string, rows: SheetRow[]) => {
  const names = Array.from(
    new Set(
      rows
        .map((row) => row.metadata?.leadName)
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => value.trim()),
    ),
  ).slice(0, 5000);

  if (names.length === 0) return rows;

  const leads = await (prisma as any).lead.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: names.map((name) => ({ name: { equals: name, mode: 'insensitive' } })),
    },
    select: { id: true, name: true },
  });

  const byName = new Map<string, string>();
  leads.forEach((lead: any) => byName.set(normalizeKey(lead.name), lead.id));

  return rows.map((row) => {
    if (row.metadata?.leadId || !row.metadata?.leadName) return row;
    const leadId = byName.get(normalizeKey(row.metadata.leadName));
    if (!leadId) return row;
    return {
      ...row,
      metadata: {
        ...(row.metadata || {}),
        leadId,
      },
    };
  });
};

const parseCsv = (buffer: Buffer) => {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      current = '';
      continue;
    }
    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((cell, index) => cell.trim() || `Column ${index + 1}`);
  return rows.slice(1).map((cells) =>
    headers.reduce<Record<string, unknown>>((record, header, index) => {
      record[header] = cells[index] ?? '';
      return record;
    }, {}),
  );
};

const parseWorkbook = async (buffer: Buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows: unknown[][] = [];
  worksheet.eachRow((excelRow) => {
    const values = Array.isArray(excelRow.values) ? excelRow.values.slice(1) : [];
    if (values.some((value) => String(value ?? '').trim())) rows.push(values);
  });
  if (rows.length === 0) return [];
  const headers = rows[0].map((value, index) => String(value ?? '').trim() || `Column ${index + 1}`);
  return rows.slice(1).map((cells) =>
    headers.reduce<Record<string, unknown>>((record, header, index) => {
      const value = cells[index] as any;
      record[header] = value?.text || value?.result || value || '';
      return record;
    }, {}),
  );
};

export const listSheets = async (workspaceId: string, query: ListSheetsQuery) => {
  const where: any = {
    workspaceId,
    deletedAt: null,
    ...(query.search
      ? {
          name: { contains: query.search, mode: 'insensitive' },
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    (prisma as any).sheet.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        source: true,
        rows: true,
        columns: true,
        updatedAt: true,
        createdAt: true,
        lastAutoSavedAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
    (prisma as any).sheet.count({ where }),
  ]);

  return {
    data: items.map(serialize),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
};

export const createSheet = async (workspaceId: string, actorId: string | undefined, input: CreateSheetInput) => {
  const columns = input.columns?.length
    ? input.columns
    : Array.from({ length: 8 }, (_, index) => ({
        id: `column_${index + 1}`,
        label: `Column ${index + 1}`,
        type: 'text',
        width: 160,
      }));
  const rows = input.rows?.length
    ? input.rows
    : Array.from({ length: 25 }, (_, index) => ({
        id: `row_${index + 1}`,
        cells: {},
      }));

  const sheet = await (prisma as any).sheet.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description || null,
      source: input.source || 'BLANK',
      columns,
      rows,
      formatting: input.formatting || {},
      metadata: input.metadata || {},
      originalSnapshot: input.originalSnapshot || { columns, rows },
      createdById: actorId || null,
      updatedById: actorId || null,
    },
  });
  await createVersion(sheet, actorId);
  return serialize(sheet);
};

export const getSheet = async (workspaceId: string, id: string) => {
  const sheet = await (prisma as any).sheet.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      updatedBy: { select: { id: true, name: true, email: true } },
    },
  });
  if (!sheet) {
    const error: any = new Error('Sheet not found.');
    error.statusCode = 404;
    throw error;
  }
  return serialize(sheet);
};

export const getSheetRows = async (workspaceId: string, id: string, query: SheetRowsQuery) => {
  const sheet = await getSheet(workspaceId, id);
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  return {
    rows: rows.slice(query.offset, query.offset + query.limit),
    total: rows.length,
    offset: query.offset,
    limit: query.limit,
  };
};

export const updateSheet = async (
  workspaceId: string,
  actorId: string | undefined,
  id: string,
  input: UpdateSheetInput,
) => {
  const existing = await getSheet(workspaceId, id);
  const updated = await (prisma as any).sheet.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.columns !== undefined ? { columns: input.columns } : {}),
      ...(input.rows !== undefined ? { rows: input.rows } : {}),
      ...(input.formatting !== undefined ? { formatting: input.formatting || {} } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata || {} } : {}),
      ...(input.autoSave ? { lastAutoSavedAt: new Date() } : {}),
      updatedById: actorId || null,
    },
  });
  if (!input.autoSave) await createVersion(updated, actorId);
  return { sheet: serialize(updated), previousUpdatedAt: existing.updatedAt };
};

export const duplicateSheet = async (
  workspaceId: string,
  actorId: string | undefined,
  id: string,
  input: DuplicateSheetInput,
) => {
  const existing = await getSheet(workspaceId, id);
  return createSheet(workspaceId, actorId, {
    name: input.name || `${existing.name} Copy`,
    description: existing.description,
    source: 'DUPLICATE',
    columns: existing.columns,
    rows: existing.rows,
    formatting: existing.formatting,
    metadata: existing.metadata,
    originalSnapshot: existing.originalSnapshot,
  });
};

export const deleteSheet = async (workspaceId: string, id: string) => {
  await getSheet(workspaceId, id);
  return (prisma as any).sheet.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};

export const listVersions = async (workspaceId: string, sheetId: string) => {
  await getSheet(workspaceId, sheetId);
  return (prisma as any).sheetVersion.findMany({
    where: { workspaceId, sheetId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, name: true, createdAt: true, createdBy: { select: { id: true, name: true } } },
  });
};

export const restoreVersion = async (workspaceId: string, actorId: string | undefined, sheetId: string, versionId: string) => {
  await getSheet(workspaceId, sheetId);
  const version = await (prisma as any).sheetVersion.findFirst({ where: { id: versionId, workspaceId, sheetId } });
  if (!version) {
    const error: any = new Error('Sheet version not found.');
    error.statusCode = 404;
    throw error;
  }
  const updated = await (prisma as any).sheet.update({
    where: { id: sheetId },
    data: {
      name: version.name,
      columns: version.columns,
      rows: version.rows,
      formatting: version.formatting || {},
      metadata: version.metadata || {},
      updatedById: actorId || null,
    },
  });
  await createVersion(updated, actorId);
  return serialize(updated);
};

export const importFile = async (
  workspaceId: string,
  actorId: string | undefined,
  file: Express.Multer.File,
  name?: string,
) => {
  const lowerName = file.originalname.toLowerCase();
  const records = lowerName.endsWith('.csv') ? parseCsv(file.buffer) : await parseWorkbook(file.buffer);
  const { columns, rows: parsedRows } = buildColumnsAndRows(records);
  const rows = await enrichRowsWithLeadLinks(workspaceId, parsedRows);
  return createSheet(workspaceId, actorId, {
    name: name || file.originalname.replace(/\.[^.]+$/, '') || 'Imported Sheet',
    source: 'FILE_IMPORT',
    columns,
    rows,
    formatting: { frozenRows: 1, alternateRows: true, cells: {}, rows: {}, columns: {} },
    metadata: {
      importedFileName: file.originalname,
      importedAt: new Date().toISOString(),
      detectedLeadColumns: columns.filter((column) => column.leadFieldKey).map((column) => column.leadFieldKey),
    },
    originalSnapshot: { columns, rows },
  });
};

export const createFromLeadExport = async (
  workspaceId: string,
  actor: Actor,
  input: CreateFromLeadExportInput,
) => {
  const exported = await exportLeadCsv(workspaceId, { ...input.filters, fields: input.fields, format: 'csv' } as any, actor);
  const records = parseCsv(Buffer.isBuffer(exported.content) ? exported.content : Buffer.from(exported.content));
  const { columns, rows: parsedRows } = buildColumnsAndRows(records);
  const rows = await enrichRowsWithLeadLinks(workspaceId, parsedRows);
  return createSheet(workspaceId, actor.id, {
    name: input.name || `Lead Export ${new Date().toISOString().slice(0, 10)}`,
    source: 'LEAD_EXPORT',
    columns,
    rows,
    formatting: { frozenRows: 1, alternateRows: true, cells: {}, rows: {}, columns: {} },
    metadata: {
      leadExportFilters: input.filters,
      selectedFields: input.fields,
      importedAt: new Date().toISOString(),
      detectedLeadColumns: columns.filter((column) => column.leadFieldKey).map((column) => column.leadFieldKey),
      syncMode: 'existing_lead_services_only',
    },
    originalSnapshot: { columns, rows },
  });
};

export const exportSheet = async (workspaceId: string, id: string, format: 'csv' | 'xlsx') => {
  const sheet = await getSheet(workspaceId, id);
  const columns = (sheet.columns || []) as SheetColumn[];
  const rows = (sheet.rows || []) as SheetRow[];

  if (format === 'csv') {
    const escape = (value: unknown) => {
      const text = String(value ?? '');
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const content = [
      columns.map((column) => escape(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => escape(row.cells?.[column.id])).join(',')),
    ].join('\n');
    return {
      filename: `${sheet.name.replace(/[^a-z0-9_-]+/gi, '-')}.csv`,
      contentType: 'text/csv; charset=utf-8',
      content: Buffer.from(content, 'utf8'),
    };
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || 'Sheet');
  worksheet.columns = columns.map((column) => ({ header: column.label, key: column.id, width: Math.max(12, Math.floor((column.width || 160) / 10)) }));
  rows.forEach((row) => worksheet.addRow(row.cells || {}));
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    filename: `${sheet.name.replace(/[^a-z0-9_-]+/gi, '-')}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content: Buffer.from(buffer),
  };
};

export const syncLeadChanges = async (_workspaceId: string, _actor: Actor, input: SyncSheetInput) => {
  const supported = new Set(['name', 'email', 'phone', 'companyName', 'address', 'expectedRevenue', 'remarks']);
  const supportedChanges = input.changes.filter((change) => supported.has(change.fieldKey) && change.leadId);
  const blockedChanges = input.changes.filter((change) => !supported.has(change.fieldKey) || !change.leadId);

  return {
    applied: [],
    pending: supportedChanges.map((change) => ({
      ...change,
      status: 'REQUIRES_CONFIRMATION',
      message: 'Lead synchronization is prepared but not auto-applied from Sheets in this release.',
    })),
    blocked: blockedChanges.map((change) => ({
      ...change,
      status: 'BLOCKED',
      message:
        change.fieldKey === 'stage'
          ? 'Stage changes must use the Lead Management workflow so approval, LOB, mandatory follow-up, payment, product and rule popups are not bypassed.'
          : 'This column is not mapped to a safe lead field.',
    })),
  };
};
