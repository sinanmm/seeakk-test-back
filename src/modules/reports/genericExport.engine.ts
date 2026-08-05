import ExcelJS from 'exceljs';
import { sanitizeCsvRow } from '../../utils/excelSanitizer';

export interface ExportColumnDef {
  header: string;
  key: string;
  width?: number;
  type?: 'text' | 'number' | 'percentage' | 'date';
}

export interface GenericExportOptions {
  title: string;
  periodText?: string;
  workspaceName?: string;
  generatedBy?: string;
  generatedAt?: string;
  filtersText?: string;
  summaryMetrics?: Array<{ label: string; value: string | number }>;
  summaryColumns?: ExportColumnDef[];
  summaryData?: Array<Record<string, any>>;
  detailedColumns?: ExportColumnDef[];
  detailedData?: Array<Record<string, any>>;
}

export const generateExcelBuffer = async (options: GenericExportOptions): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = options.generatedBy || 'Seeakk CRM';
  workbook.created = new Date();

  // 1. Summary Sheet (if provided)
  if (options.summaryData && options.summaryData.length > 0) {
    const sheet = workbook.addWorksheet('Summary');

    // Title Block
    sheet.addRow([options.title.toUpperCase()]);
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
    sheet.addRow([`Workspace: ${options.workspaceName || 'Default'} | Generated: ${options.generatedAt || new Date().toISOString()}`]);
    if (options.filtersText) {
      sheet.addRow([`Filters: ${options.filtersText}`]);
    }
    sheet.addRow([]);

    // Summary Metric Cards Block
    if (options.summaryMetrics && options.summaryMetrics.length > 0) {
      const metricLabels = options.summaryMetrics.map((m) => m.label);
      const metricValues = options.summaryMetrics.map((m) => m.value);
      sheet.addRow(metricLabels);
      sheet.addRow(metricValues);
      sheet.addRow([]);
    }

    // Summary Table Header
    if (options.summaryColumns && options.summaryColumns.length > 0) {
      const headerRow = sheet.addRow(options.summaryColumns.map((c) => c.header));
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF0F766E' }, // Emerald theme
        };
      });

      // Data Rows
      options.summaryData.forEach((row) => {
        const rowValues = options.summaryColumns!.map((col) => row[col.key] ?? '');
        const addedRow = sheet.addRow(rowValues);

        options.summaryColumns!.forEach((col, idx) => {
          if (col.type === 'percentage') {
            const cell = addedRow.getCell(idx + 1);
            if (typeof cell.value === 'number') {
              cell.value = cell.value / 100;
              cell.numFmt = '0.0%';
            }
          }
        });
      });
    }

    // Auto-fit columns
    sheet.columns.forEach((column) => {
      let maxLen = 15;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      column.width = Math.min(maxLen + 4, 40);
    });
  }

  // 2. Detailed Sheet
  const detailedSheet = workbook.addWorksheet(options.summaryData ? 'Detailed Log' : 'Report');
  if (options.detailedColumns && options.detailedColumns.length > 0) {
    const headerRow = detailedSheet.addRow(options.detailedColumns.map((c) => c.header));
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' }, // Slate header
      };
    });
    detailedSheet.views = [{ state: 'frozen', ySplit: 1 }];

    (options.detailedData || []).forEach((row) => {
      const rowValues = options.detailedColumns!.map((col) => row[col.key] ?? '');
      detailedSheet.addRow(rowValues);
    });

    detailedSheet.columns.forEach((column) => {
      let maxLen = 12;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      column.width = Math.min(maxLen + 3, 50);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export const generateCsvString = (columns: ExportColumnDef[], data: Array<Record<string, any>>): string => {
  const headers = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const rows = data.map((row) => {
    const values = columns.map((col) => sanitizeCsvRow(row[col.key] ?? ''));
    return values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });

  return [headers, ...rows].join('\n');
};
