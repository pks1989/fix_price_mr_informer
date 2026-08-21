import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWithinWorkHours } from '../src/workHours.js';

const CONFIG = { startHour: 9, endHour: 19, timeZone: 'Europe/Moscow', workDays: [1, 2, 3, 4, 5] };

test('returns true inside working hours on a weekday', () => {
  // Wednesday 2026-08-19, 12:00 Moscow (UTC+3) = 09:00 UTC
  assert.equal(isWithinWorkHours(new Date('2026-08-19T09:00:00Z'), CONFIG), true);
});

test('returns false before opening hour', () => {
  // Wednesday 2026-08-19, 08:00 Moscow = 05:00 UTC
  assert.equal(isWithinWorkHours(new Date('2026-08-19T05:00:00Z'), CONFIG), false);
});

test('returns false at/after closing hour', () => {
  // Wednesday 2026-08-19, 19:00 Moscow = 16:00 UTC (end hour is exclusive)
  assert.equal(isWithinWorkHours(new Date('2026-08-19T16:00:00Z'), CONFIG), false);
});

test('returns false on a weekend', () => {
  // Saturday 2026-08-22, 12:00 Moscow = 09:00 UTC
  assert.equal(isWithinWorkHours(new Date('2026-08-22T09:00:00Z'), CONFIG), false);
});
