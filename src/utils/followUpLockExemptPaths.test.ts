import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { isFollowUpLockResolutionPath } from './followUpLockExemptPaths';

const mockReq = (method: string, originalUrl: string): Request =>
  ({
    method,
    originalUrl,
    baseUrl: '',
    path: originalUrl.split('?')[0],
    url: originalUrl.split('?')[0],
  }) as Request;

test('allows mandatory continuation read/write', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/followups/mandatory-continuation')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/mandatory-continuation')), true);
});

test('allows overdue mandatory status, weekly-off lookup, and reminder alerts', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/followups/overdue-mandatory')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/holidays/weekly-off')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/followups/alerts?minutesAhead=15')), true);
});

test('allows bulk extend even when originalUrl has a trailing slash', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/bulk-extend/')), true);
});

test('allows complete, extend, create, and bulk reschedule endpoints', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/fu-1/complete')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('PATCH', '/api/followups/fu-1/snooze')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/fu-1/extend')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/fu-1/schedule')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups')), true);
  assert.equal(isFollowUpLockResolutionPath(mockReq('POST', '/api/followups/bulk-extend')), true);
});

test('allows mounted-router overdue mandatory path', () => {
  const req = {
    method: 'GET',
    originalUrl: '',
    baseUrl: '/api/followups',
    path: '/overdue-mandatory',
    url: '/overdue-mandatory',
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows mounted-router bulk extend path without full originalUrl', () => {
  const req = {
    method: 'POST',
    originalUrl: '/bulk-extend',
    baseUrl: '/api/followups',
    path: '/bulk-extend',
    url: '/bulk-extend',
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows bulk extend via express route binding on Render', () => {
  const req = {
    method: 'POST',
    originalUrl: '/bulk-extend',
    baseUrl: '/api/followups',
    path: '/bulk-extend',
    url: '/bulk-extend',
    route: { path: '/bulk-extend' },
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows bulk extend when only mount-relative bulk-extend path is present', () => {
  const req = {
    method: 'POST',
    originalUrl: '',
    baseUrl: '',
    path: 'bulk-extend',
    url: 'bulk-extend',
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows mounted-router weekly-off path without full originalUrl', () => {
  const req = {
    method: 'GET',
    originalUrl: '/weekly-off',
    baseUrl: '/api/holidays',
    path: '/weekly-off',
    url: '/weekly-off',
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows mounted-router alerts path without full originalUrl', () => {
  const req = {
    method: 'GET',
    originalUrl: '/alerts?minutesAhead=15&includePastMinutes=5',
    baseUrl: '/api/followups',
    path: '/alerts',
    url: '/alerts?minutesAhead=15&includePastMinutes=5',
  } as Request;
  assert.equal(isFollowUpLockResolutionPath(req), true);
});

test('allows active extension reasons lookup during overdue resolution', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/followup-extension-reasons/active')), true);
});

test('blocks unrelated dashboard routes', () => {
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/dashboard/summary')), false);
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/dashboard/revenue')), false);
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/leads')), false);
  assert.equal(isFollowUpLockResolutionPath(mockReq('GET', '/api/lead-dynamics/active')), false);
});
