import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImportFollowUpDate } from './leadImport.service';

test('parseImportFollowUpDate correctly parses MM/DD/YY hh:mm am/pm', () => {
  const parsed = parseImportFollowUpDate('02/27/25 10:00 am');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2025);
  assert.equal(parsed.getMonth(), 1); // February (0-indexed)
  assert.equal(parsed.getDate(), 27);
  assert.equal(parsed.getHours(), 10);
  assert.equal(parsed.getMinutes(), 0);
});

test('parseImportFollowUpDate correctly parses MM/DD/YYYY hh:mm am/pm', () => {
  const parsed = parseImportFollowUpDate('02/27/2025 10:00 am');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2025);
  assert.equal(parsed.getMonth(), 1);
  assert.equal(parsed.getDate(), 27);
  assert.equal(parsed.getHours(), 10);
});

test('parseImportFollowUpDate correctly handles PM times', () => {
  const parsed = parseImportFollowUpDate('02/27/25 02:30 pm');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getHours(), 14);
  assert.equal(parsed.getMinutes(), 30);
});

test('parseImportFollowUpDate correctly handles date without time', () => {
  const parsed = parseImportFollowUpDate('02/27/2025');
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.getFullYear(), 2025);
  assert.equal(parsed.getMonth(), 1);
  assert.equal(parsed.getDate(), 27);
});

test('parseImportFollowUpDate returns null for invalid date strings', () => {
  assert.equal(parseImportFollowUpDate('invalid date string'), null);
  assert.equal(parseImportFollowUpDate(''), null);
  assert.equal(parseImportFollowUpDate(null), null);
});
