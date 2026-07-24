import assert from 'assert';
import { sanitizeExcelCell, sanitizeCsvRow } from '../utils/excelSanitizer';
import { validateUploadedFile, sanitizeStorageKey } from '../utils/fileValidation.util';

export const runSecurityRemediationTests = (): void => {
  // SEC-002 Formula Injection Tests
  assert.strictEqual(sanitizeExcelCell('=SUM(1,2)'), "'=SUM(1,2)");
  assert.strictEqual(sanitizeExcelCell('+cmd|/c'), "'+cmd|/c");
  assert.strictEqual(sanitizeExcelCell('-10+20'), "'-10+20");
  assert.strictEqual(sanitizeExcelCell('@SUM(A1)'), "'@SUM(A1)");
  assert.strictEqual(sanitizeExcelCell('\tcalc'), "'\tcalc");
  assert.strictEqual(sanitizeExcelCell(12345), 12345);
  assert.strictEqual(sanitizeExcelCell(true), true);
  assert.strictEqual(sanitizeExcelCell('John Doe'), 'John Doe');

  const rawRow = ['Admin User', '=1+1', '-100', 'Normal Remark'];
  const sanitized = sanitizeCsvRow(rawRow);
  assert.deepStrictEqual(sanitized, ['Admin User', "'=1+1", "'-100", 'Normal Remark']);

  // SEC-001 & SEC-006 File Storage & Key Sanitization Tests
  assert.strictEqual(sanitizeStorageKey('uploads/images/photo.png'), 'uploads/images/photo.png');
  assert.throws(() => sanitizeStorageKey('../../etc/passwd'));
  assert.throws(() => sanitizeStorageKey('uploads/../../secret.key'));

  const fakeExeFile: any = {
    originalname: 'malicious.exe',
    mimetype: 'application/octet-stream',
    size: 500,
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
  };
  assert.strictEqual(validateUploadedFile(fakeExeFile).valid, false);

  const validPngFile: any = {
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  };
  assert.strictEqual(validateUploadedFile(validPngFile).valid, true);

  console.info('✅ Security Remediation Tests Passed Successfully!');
};

if (require.main === module) {
  runSecurityRemediationTests();
}
