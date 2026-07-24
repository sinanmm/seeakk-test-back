import path from 'path';
import crypto from 'crypto';

/**
 * File validation rules & magic byte signatures.
 * SEC-006: Multi-layered file upload validation.
 */

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

/**
 * Validates extension, MIME type, and magic bytes for an uploaded file buffer.
 */
export const validateUploadedFile = (
  file: Express.Multer.File,
  options?: { maxSizeBytes?: number; allowedTypes?: string[] },
): { valid: boolean; error?: string } => {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  // 1. Size Limit Check
  const maxSizeBytes = options?.maxSizeBytes || 10 * 1024 * 1024; // Default 10MB
  if (file.size > maxSizeBytes) {
    const sizeMb = (maxSizeBytes / (1024 * 1024)).toFixed(0);
    return { valid: false, error: `File size exceeds maximum allowed limit of ${sizeMb}MB.` };
  }

  // 2. Extension Check
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File extension '${ext}' is not supported.` };
  }

  // 3. MIME Type Check
  const mime = (file.mimetype || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { valid: false, error: `MIME type '${mime}' is not permitted.` };
  }

  // 4. Magic Bytes Inspection (if buffer is present in memory)
  if (file.buffer && file.buffer.length >= 4) {
    const headerHex = file.buffer.slice(0, 4).toString('hex').toLowerCase();

    // Reject executable binary headers (ELF, EXE, SH, etc.)
    if (headerHex.startsWith('4d5a') || headerHex.startsWith('7f454c46')) {
      return { valid: false, error: 'Executable files are strictly prohibited.' };
    }

    // Check specific magic bytes for images/PDFs
    if (ext === '.png' && !headerHex.startsWith('89504e47')) {
      return { valid: false, error: 'File content does not match PNG format.' };
    }

    if ((ext === '.jpg' || ext === '.jpeg') && !headerHex.startsWith('ffd8ff')) {
      return { valid: false, error: 'File content does not match JPEG format.' };
    }

    if (ext === '.pdf' && !headerHex.startsWith('25504446')) { // %PDF
      return { valid: false, error: 'File content does not match PDF format.' };
    }
  }

  return { valid: true };
};

/**
 * Generates a clean, normalized, non-traversable storage key for a file.
 */
export const sanitizeStorageKey = (rawKey: string): string => {
  if (!rawKey) return '';

  if (rawKey.includes('..') || rawKey.includes('\0')) {
    throw new Error('Invalid storage key sequence detected.');
  }

  const normalized = path.normalize(rawKey);
  const clean = normalized
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  return clean;
};

/**
 * Generates a unique, collision-free safe filename for storage.
 */
export const generateSafeStorageKey = (originalname: string, prefix = 'uploads'): string => {
  const ext = path.extname(originalname || '').toLowerCase();
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.bin';
  const timestamp = Date.now();
  const randomHex = crypto.randomBytes(8).toString('hex');
  return `${prefix}/${timestamp}-${randomHex}${safeExt}`;
};
