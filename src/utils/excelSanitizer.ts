/**
 * Central CSV & Excel Formula Injection Sanitization Utility
 * SEC-002: Protects export fields against formula execution in Microsoft Excel, LibreOffice, and Google Sheets.
 */

const DANGEROUS_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r', '\n'];

/**
 * Escapes a single cell value if it starts with a dangerous formula prefix.
 * Preserves numbers, booleans, dates, nulls, and clean text untouched.
 */
export const sanitizeExcelCell = (value: any): any => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  const stringVal = String(value);
  if (stringVal.length === 0) {
    return stringVal;
  }

  const firstChar = stringVal.charAt(0);

  if (DANGEROUS_FORMULA_PREFIXES.includes(firstChar)) {
    return `'${stringVal}`;
  }

  return stringVal;
};

/**
 * Sanitizes an array of row values for CSV or Excel export.
 */
export const sanitizeCsvRow = (row: any[]): any[] => {
  return row.map((cell) => sanitizeExcelCell(cell));
};

/**
 * Sanitizes a key-value record object for export.
 */
export const sanitizeExportRecord = <T extends Record<string, any>>(
  record: T,
  fieldsToSanitize?: (keyof T)[],
): T => {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const sanitized: Record<string, any> = { ...record };
  const keys = fieldsToSanitize ? (fieldsToSanitize as string[]) : Object.keys(record);

  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
      sanitized[key] = sanitizeExcelCell(sanitized[key]);
    }
  });

  return sanitized as T;
};
