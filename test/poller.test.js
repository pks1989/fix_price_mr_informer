import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { runPollCycle } from '../src/poller.js';
import { LABELS } from '../src/labelState.js';

const WORK_HOURS = { startHour: 9, endHour: 19, timeZone: 'Europe/Moscow', workDays: [1, 2, 3, 4, 5] };
// Wednesday 2026-08-19, 12:00 Moscow = 09:00 UTC (inside work hours)
const NOON_MOSCOW = new Date('2026-08-19T09:00:00Z');
const REMINDER_MS = 3 * 60 * 60 * 1000;

function baseConfig() {
  return {
    gitlab: { baseUrl: 'https://git.example.com', token: 't', projectPath: 'g/p' },
    allowedUsers: ['alice', 'bob'],
    noLabelGraceMs: 900000,
    reminderIntervalMs: REMINDER_MS,
    workHours: WORK_HOURS,
  };
}

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-informer-poller-'));
  return createStore(path.join(dir, 'store.json'));
}

function fakeGitlabClient(mrs) {
  return { fetchOpenMergeRequests: async () => mrs };
}

function fakeNotifier() {
  const dms = [];
  const group = [];
  return {
    dms,
    group,
    notifyUser: async (chatId, text) => dms.push({ chatId, text }),
    notifyGroup: async (text) => group.push(text),
  };
}

function mr(overrides = {}) {
  return {
    iid: 1,
    title: 'Some MR',
    url: 'https://git.example.com/mr/1',
    authorUsername: 'alice',
    reviewerUsername: 'bob',
    labels: [LABELS.REVIEW_REQUESTED],
    draft: false,
    createdAt: '2026-08-19T08:00:00Z',
    ...overrides,
  };
}

test('a new action-item MR notifies the responsible registered user and logs to the group', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = fakeNotifier();

  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr()]),
    store,
    notifier,
    config: baseConfig(),
    now: NOON_MOSCOW,
  });

  assert.equal(notifier.dms.length, 1);
  assert.equal(notifier.dms[0].chatId, 999);
  assert.equal(notifier.group.length, 1);
  assert.deepEqual(store.getMr('1'), { state: 'review_requested', lastReminderAt: NOON_MOSCOW.getTime(), title: 'Some MR', url: 'https://git.example.com/mr/1', dmDelivered: true });
});

test('an unregistered responsible user gets no DM but the group is still logged', async () => {
  const store = tempStore();
  const notifier = fakeNotifier();

  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr()]),
    store,
    notifier,
    config: baseConfig(),
    now: NOON_MOSCOW,
  });

  assert.equal(notifier.dms.length, 0);
  assert.equal(notifier.group.length, 1);
  assert.match(notifier.group[0], /не зарегистрирован/);
  assert.deepEqual(store.getMr('1'), { state: 'review_requested', lastReminderAt: NOON_MOSCOW.getTime(), title: 'Some MR', url: 'https://git.example.com/mr/1', dmDelivered: false });
});

test('registering after an unregistered notification delivers the pending DM next cycle, without re-spamming the group', async () => {
  const store = tempStore();
  const notifier = fakeNotifier();
  const config = baseConfig();

  // Cycle 1: responsible user (bob) not registered yet.
  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: NOON_MOSCOW });
  assert.equal(notifier.dms.length, 0);
  assert.equal(notifier.group.length, 1);
  notifier.dms.length = 0;
  notifier.group.length = 0;

  // Bob registers between cycles.
  store.setUser(999, 'bob');

  // Cycle 2: well within the reminder interval, but the DM should still be
  // delivered promptly since it was never actually sent — and the group
  // must NOT get a second message (no spam).
  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr()]),
    store,
    notifier,
    config,
    now: new Date(NOON_MOSCOW.getTime() + 60000),
  });

  assert.equal(notifier.dms.length, 1);
  assert.equal(notifier.dms[0].chatId, 999);
  assert.equal(notifier.group.length, 0);
  assert.equal(store.getMr('1').dmDelivered, true);

  // Cycle 3: still within the reminder interval — nothing further should fire.
  notifier.dms.length = 0;
  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr()]),
    store,
    notifier,
    config,
    now: new Date(NOON_MOSCOW.getTime() + 120000),
  });

  assert.equal(notifier.dms.length, 0);
  assert.equal(notifier.group.length, 0);
});

test('an unchanged state within the reminder interval sends nothing on the next cycle', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = fakeNotifier();
  const config = baseConfig();

  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: NOON_MOSCOW });
  notifier.dms.length = 0;
  notifier.group.length = 0;

  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr()]),
    store,
    notifier,
    config,
    now: new Date(NOON_MOSCOW.getTime() + 60000),
  });

  assert.equal(notifier.dms.length, 0);
  assert.equal(notifier.group.length, 0);
});

test('an unchanged state past the reminder interval sends a reminder', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = fakeNotifier();
  const config = baseConfig();

  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: NOON_MOSCOW });
  notifier.dms.length = 0;
  notifier.group.length = 0;

  const later = new Date(NOON_MOSCOW.getTime() + REMINDER_MS + 1000);
  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: later });

  assert.equal(notifier.dms.length, 1);
  assert.match(notifier.dms[0].text, /^Напоминание/);
});

test('a draft MR is never tracked or notified', async () => {
  const store = tempStore();
  const notifier = fakeNotifier();

  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr({ draft: true })]),
    store,
    notifier,
    config: baseConfig(),
    now: NOON_MOSCOW,
  });

  assert.equal(notifier.dms.length, 0);
  assert.equal(notifier.group.length, 0);
  assert.deepEqual(store.getAllMrKeys(), []);
});

test('an MR that disappears between cycles is logged as no longer tracked and removed from the store', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = fakeNotifier();
  const config = baseConfig();

  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: NOON_MOSCOW });
  notifier.dms.length = 0;
  notifier.group.length = 0;

  await runPollCycle({ gitlabClient: fakeGitlabClient([]), store, notifier, config, now: NOON_MOSCOW });

  assert.deepEqual(store.getAllMrKeys(), []);
  assert.equal(notifier.group.length, 1);
  assert.match(notifier.group[0], /больше не отслеживается/);
});

function throwingNotifier() {
  const group = [];
  return {
    group,
    notifyUser: async () => { throw new Error('blocked by user'); },
    notifyGroup: async (text) => { group.push(text); },
  };
}

test('a notifier failure on one MR does not abort processing of the rest of the cycle', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = throwingNotifier();

  const mrs = [
    mr({ iid: 1 }),
    mr({ iid: 2, title: 'Second MR', url: 'https://git.example.com/mr/2', authorUsername: 'alice', reviewerUsername: null, labels: [LABELS.DONE] }),
  ];

  await runPollCycle({
    gitlabClient: fakeGitlabClient(mrs),
    store,
    notifier,
    config: baseConfig(),
    now: NOON_MOSCOW,
  });

  // First MR: notifyUser threw (caught by safeSend), but the cycle continued and
  // still persisted state as if the send had been attempted (chatId was resolved).
  assert.deepEqual(store.getMr('1'), { state: 'review_requested', lastReminderAt: NOON_MOSCOW.getTime(), title: 'Some MR', url: 'https://git.example.com/mr/1', dmDelivered: true });

  // Second MR: unrelated, must still be processed normally (no responsible chatId,
  // so no DM was delivered, but the group-log cadence still advances normally).
  assert.deepEqual(store.getMr('2'), { state: 'done', lastReminderAt: NOON_MOSCOW.getTime(), title: 'Second MR', url: 'https://git.example.com/mr/2', dmDelivered: false });
});

test('a previously tracked MR that flips to draft (skip) is logged with a Russian label, not the raw "skip" string', async () => {
  const store = tempStore();
  store.setUser(999, 'bob');
  const notifier = fakeNotifier();
  const config = baseConfig();

  await runPollCycle({ gitlabClient: fakeGitlabClient([mr()]), store, notifier, config, now: NOON_MOSCOW });
  notifier.dms.length = 0;
  notifier.group.length = 0;

  await runPollCycle({
    gitlabClient: fakeGitlabClient([mr({ draft: true })]),
    store,
    notifier,
    config,
    now: new Date(NOON_MOSCOW.getTime() + 60000),
  });

  assert.equal(notifier.group.length, 1);
  assert.doesNotMatch(notifier.group[0], /\bskip\b/);
});
