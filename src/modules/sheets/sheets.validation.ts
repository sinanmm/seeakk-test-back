import { z } from 'zod';

const jsonRecord = z.record(z.string(), z.any());

export const listSheetsQuerySchema = z.object({
  search: z.string().optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const sheetRowsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(200),
});

export const createSheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  columns: z.array(jsonRecord).optional(),
  rows: z.array(jsonRecord).optional(),
  formatting: jsonRecord.optional().nullable(),
  metadata: jsonRecord.optional().nullable(),
  originalSnapshot: jsonRecord.optional().nullable(),
  source: z.string().trim().max(40).optional(),
});

export const updateSheetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  columns: z.array(jsonRecord).optional(),
  rows: z.array(jsonRecord).optional(),
  formatting: jsonRecord.optional().nullable(),
  metadata: jsonRecord.optional().nullable(),
  autoSave: z.boolean().optional().default(false),
});

export const renameSheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const duplicateSheetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
});

export const createFromLeadExportSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  fields: z.array(z.string().trim().min(1)).min(1),
  filters: jsonRecord.optional().default({}),
});

export const syncSheetSchema = z.object({
  changes: z
    .array(
      z.object({
        rowId: z.string().min(1),
        leadId: z.string().optional().nullable(),
        fieldKey: z.string().min(1),
        oldValue: z.any().optional(),
        newValue: z.any(),
      }),
    )
    .optional()
    .default([]),
});

export type ListSheetsQuery = z.infer<typeof listSheetsQuerySchema>;
export type SheetRowsQuery = z.infer<typeof sheetRowsQuerySchema>;
export type CreateSheetInput = z.infer<typeof createSheetSchema>;
export type UpdateSheetInput = z.infer<typeof updateSheetSchema>;
export type RenameSheetInput = z.infer<typeof renameSheetSchema>;
export type DuplicateSheetInput = z.infer<typeof duplicateSheetSchema>;
export type CreateFromLeadExportInput = z.infer<typeof createFromLeadExportSchema>;
export type SyncSheetInput = z.infer<typeof syncSheetSchema>;
