import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES } from '../src/labelState.js';
import { decideAction } from '../src/decision.js';

const NOW = new Date('2026-08-19T12:00:00Z').getTime();
const REMINDER_MS = 3 * 60 * 60 * 1000;

test('new action-state MR with no history triggers notify_new', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: null,
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'notify_new' });
});

test('new non-action-state MR with no history triggers log_transition', () => {
  const action = decideAction({
    derived: { state: STATES.IN_REVIEW, responsibleUsername: null },
    previous: null,
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'log_transition' });
});

test('state change between two action states triggers notify_new', () => {
  const action = decideAction({
    derived: { state: STATES.DONE, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'notify_new' });
});

test('unchanged action state within reminder interval does nothing', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('unchanged action state past reminder interval reminds', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - REMINDER_MS - 1 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'notify_reminder' });
});

test('unchanged non-action state never reminds', () => {
  const action = decideAction({
    derived: { state: STATES.IN_REVIEW, responsibleUsername: null },
    previous: { state: STATES.IN_REVIEW, lastReminderAt: 0 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('MR that becomes skip after being tracked triggers one log_transition', () => {
  const action = decideAction({
    derived: { state: STATES.SKIP, responsibleUsername: null },
    previous: { state: STATES.NEEDS_CHANGES, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'log_transition' });
});

test('MR that stays skip does nothing', () => {
  const action = decideAction({
    derived: { state: STATES.SKIP, responsibleUsername: null },
    previous: { state: STATES.SKIP, lastReminderAt: 0 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
  });
  assert.deepEqual(action, { type: 'none' });
});
