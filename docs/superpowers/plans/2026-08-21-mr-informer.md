# mr-informer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js Telegram bot that polls one GitLab project's merge requests, derives whose turn it is to act from MR labels, and pushes DM/group notifications (plus periodic reminders) to close the reaction-lag gap between the two reviewers.

**Architecture:** A single long-running Node process: a 3-minute poll loop pulls open MRs from the GitLab REST API, a small pure state machine derives the current status and responsible person per MR, a pure decision function compares against a JSON-file-backed history to decide whether to notify/remind/log, and a Telegraf bot sends DMs plus a group log. All decision logic lives in pure, dependency-injected modules so it's unit-testable without hitting GitLab or Telegram; only `src/index.js` wires the real GitLab fetch, real JSON store, and real Telegraf bot together.

**Tech Stack:** Node.js >=20 (ESM, global `fetch`, built-in `node:test`), `telegraf` for the Telegram bot, `dotenv` for env loading, flat JSON file for persistence. No database, no TypeScript, no build step.

**Spec:** `docs/superpowers/specs/2026-08-21-mr-informer-spec.md`

## Global Constraints

- Node.js >=20, ESM modules (`"type": "module"` in package.json) — no build step.
- Dependencies limited to `telegraf` and `dotenv`; no test framework dependency — use built-in `node:test` + `node:assert/strict`.
- Persistence is a single flat JSON file (default `./data/store.json`) — no database.
- GitLab access is strictly read-only: only `GET` requests against the GitLab REST API, never write/comment/label.
- Secrets (`TELEGRAM_BOT_TOKEN`, `GITLAB_TOKEN`) live in `.env`, which is gitignored; `.env.example` documents required vars with empty values.
- Reminders only fire inside the work-hours window (default 9:00–19:00 Europe/Moscow, Mon–Fri); the very first notification of a new/changed state fires immediately regardless of hour.
- Known status labels (Russian, exact strings): `требуется ревью`, `ревью`, `требуются уточнения`, `готово`.

---

### Task 1: Project scaffolding and config loader

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Produces: `parseCsvList(value: string|undefined): string[]`, `parseIntEnv(value: string|undefined, fallback: number): number`, `loadConfig(env?: object): Config` where `Config` is `{ telegramBotToken, groupChatId: number|null, gitlab: { baseUrl, token, projectPath }, allowedUsers: string[], pollIntervalMs, reminderIntervalMs, noLabelGraceMs, workHours: { startHour, endHour, timeZone, workDays: number[] }, storePath }`.

- [ ] **Step 1: Initialize git repo and Node project files**

Run:
```bash
cd /home/kostya/work/fix_price/serbia/telegram_mr_informer
git init
```

Create `package.json`:
```json
{
  "name": "mr-informer",
  "version": "1.0.0",
  "description": "Telegram bot that highlights required actions for the GitLab MR review flow",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "telegraf": "^4.16.3"
  }
}
```

Create `.gitignore`:
```
node_modules/
.env
data/*
!data/.gitkeep
```

Create `.env.example`:
```
TELEGRAM_BOT_TOKEN=
GITLAB_BASE_URL=https://git.fix-price.ru
GITLAB_TOKEN=
GITLAB_PROJECT_PATH=android/fixprice_serbia
ALLOWED_GITLAB_USERS=user1,user2
GROUP_CHAT_ID=
POLL_INTERVAL_MS=180000
REMINDER_INTERVAL_MS=10800000
NO_LABEL_GRACE_MS=900000
WORK_HOURS_START=9
WORK_HOURS_END=19
WORK_TZ=Europe/Moscow
WORK_DAYS=1,2,3,4,5
STORE_PATH=./data/store.json
```

Create empty `data/.gitkeep` (zero-byte file).

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install
```
Expected: `node_modules/` created, `package-lock.json` generated, no errors.

- [ ] **Step 3: Write failing test for config.js**

Create `test/config.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvList, parseIntEnv, loadConfig } from '../src/config.js';

test('parseCsvList splits, trims and drops empties', () => {
  assert.deepEqual(parseCsvList('a, b ,,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvList(undefined), []);
});

test('parseIntEnv parses valid integers and falls back otherwise', () => {
  assert.equal(parseIntEnv('42', 0), 42);
  assert.equal(parseIntEnv('not-a-number', 7), 7);
  assert.equal(parseIntEnv(undefined, 7), 7);
});

test('loadConfig reads and normalizes environment variables', () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'tg-token',
    GITLAB_BASE_URL: 'https://git.example.com',
    GITLAB_TOKEN: 'gl-token',
    GITLAB_PROJECT_PATH: 'group/project',
    ALLOWED_GITLAB_USERS: 'alice,bob',
    GROUP_CHAT_ID: '-100123',
    POLL_INTERVAL_MS: '60000',
    REMINDER_INTERVAL_MS: '3600000',
    NO_LABEL_GRACE_MS: '60000',
    WORK_HOURS_START: '10',
    WORK_HOURS_END: '18',
    WORK_TZ: 'Europe/Moscow',
    WORK_DAYS: '1,2,3,4,5',
    STORE_PATH: './data/store.json',
  });

  assert.equal(config.telegramBotToken, 'tg-token');
  assert.equal(config.groupChatId, -100123);
  assert.deepEqual(config.allowedUsers, ['alice', 'bob']);
  assert.equal(config.gitlab.projectPath, 'group/project');
  assert.equal(config.pollIntervalMs, 60000);
  assert.equal(config.reminderIntervalMs, 3600000);
  assert.equal(config.noLabelGraceMs, 60000);
  assert.deepEqual(config.workHours, {
    startHour: 10,
    endHour: 18,
    timeZone: 'Europe/Moscow',
    workDays: [1, 2, 3, 4, 5],
  });
});

test('loadConfig applies defaults when optional vars are missing', () => {
  const config = loadConfig({});
  assert.equal(config.pollIntervalMs, 180000);
  assert.equal(config.reminderIntervalMs, 10800000);
  assert.equal(config.noLabelGraceMs, 900000);
  assert.equal(config.groupChatId, null);
  assert.deepEqual(config.workHours, {
    startHour: 9,
    endHour: 19,
    timeZone: 'Europe/Moscow',
    workDays: [1, 2, 3, 4, 5],
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 5: Implement config.js**

Create `src/config.js`:
```js
function parseCsvList(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntEnv(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfig(env = process.env) {
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    groupChatId: env.GROUP_CHAT_ID ? Number(env.GROUP_CHAT_ID) : null,
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL,
      token: env.GITLAB_TOKEN,
      projectPath: env.GITLAB_PROJECT_PATH,
    },
    allowedUsers: parseCsvList(env.ALLOWED_GITLAB_USERS),
    pollIntervalMs: parseIntEnv(env.POLL_INTERVAL_MS, 180000),
    reminderIntervalMs: parseIntEnv(env.REMINDER_INTERVAL_MS, 10800000),
    noLabelGraceMs: parseIntEnv(env.NO_LABEL_GRACE_MS, 900000),
    workHours: {
      startHour: parseIntEnv(env.WORK_HOURS_START, 9),
      endHour: parseIntEnv(env.WORK_HOURS_END, 19),
      timeZone: env.WORK_TZ ?? 'Europe/Moscow',
      workDays: parseCsvList(env.WORK_DAYS ?? '1,2,3,4,5').map(Number),
    },
    storePath: env.STORE_PATH ?? './data/store.json',
  };
}

export { parseCsvList, parseIntEnv, loadConfig };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example data/.gitkeep src/config.js test/config.test.js
git commit -m "chore: scaffold project and add config loader"
```

---

### Task 2: Work-hours check

**Files:**
- Create: `src/workHours.js`
- Test: `test/workHours.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `isWithinWorkHours(date: Date, config: { startHour, endHour, timeZone, workDays }): boolean`.

- [ ] **Step 1: Write failing tests**

Create `test/workHours.test.js`:
```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/workHours.js'`

- [ ] **Step 3: Implement workHours.js**

Create `src/workHours.js`:
```js
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function isWithinWorkHours(date, { startHour, endHour, timeZone, workDays }) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(date);

  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const weekday = WEEKDAY_INDEX[parts.find((p) => p.type === 'weekday').value];

  return workDays.includes(weekday) && hour >= startHour && hour < endHour;
}

export { isWithinWorkHours };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 4 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/workHours.js test/workHours.test.js
git commit -m "feat: add work-hours window check"
```

---

### Task 3: MR label state machine

**Files:**
- Create: `src/labelState.js`
- Test: `test/labelState.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LABELS` (object of the 4 known Russian label strings), `STATES` (object of state name constants: `SKIP`, `NO_LABEL`, `REVIEW_REQUESTED`, `IN_REVIEW`, `NEEDS_CHANGES`, `DONE`), `ACTION_STATES: Set<string>`, `deriveMrState(mr, { allowedUsers, now, noLabelGraceMs }): { state: string, responsibleUsername: string|null }` where `mr` is `{ iid, title, url, authorUsername, reviewerUsername, labels: string[], draft: boolean, createdAt: string }`.

- [ ] **Step 1: Write failing tests**

Create `test/labelState.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, deriveMrState } from '../src/labelState.js';

const NOW = new Date('2026-08-19T12:00:00Z');
const ALLOWED = ['alice', 'bob'];

function baseMr(overrides = {}) {
  return {
    iid: 1,
    title: 'Some MR',
    url: 'https://git.example.com/mr/1',
    authorUsername: 'alice',
    reviewerUsername: 'bob',
    labels: [],
    draft: false,
    createdAt: '2026-08-19T11:00:00Z',
    ...overrides,
  };
}

test('MR with neither author nor reviewer allowed is skipped', () => {
  const mr = baseMr({ authorUsername: 'carol', reviewerUsername: 'dave' });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.SKIP, responsibleUsername: null });
});

test('draft MR is skipped even if labeled', () => {
  const mr = baseMr({ draft: true, labels: ['требуется ревью'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.SKIP, responsibleUsername: null });
});

test('"требуется ревью" makes the reviewer responsible', () => {
  const mr = baseMr({ labels: ['требуется ревью'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' });
});

test('"ревью" has no responsible person', () => {
  const mr = baseMr({ labels: ['ревью'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.IN_REVIEW, responsibleUsername: null });
});

test('"требуются уточнения" makes the author responsible', () => {
  const mr = baseMr({ labels: ['требуются уточнения'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.NEEDS_CHANGES, responsibleUsername: 'alice' });
});

test('"готово" makes the reviewer responsible', () => {
  const mr = baseMr({ labels: ['готово'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.DONE, responsibleUsername: 'bob' });
});

test('conflicting labels resolve by done > needs_changes > in_review > review_requested', () => {
  const mr = baseMr({ labels: ['требуется ревью', 'готово'] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.equal(result.state, STATES.DONE);
});

test('no known label within the grace period is skipped', () => {
  const mr = baseMr({ labels: [], createdAt: '2026-08-19T11:50:00Z' }); // 10 min old
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.SKIP, responsibleUsername: null });
});

test('no known label past the grace period flags the author', () => {
  const mr = baseMr({ labels: [], createdAt: '2026-08-19T11:00:00Z' }); // 60 min old
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.NO_LABEL, responsibleUsername: 'alice' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/labelState.js'`

- [ ] **Step 3: Implement labelState.js**

Create `src/labelState.js`:
```js
const LABELS = {
  REVIEW_REQUESTED: 'требуется ревью',
  IN_REVIEW: 'ревью',
  NEEDS_CHANGES: 'требуются уточнения',
  DONE: 'готово',
};

const STATES = {
  SKIP: 'skip',
  NO_LABEL: 'no_label',
  REVIEW_REQUESTED: 'review_requested',
  IN_REVIEW: 'in_review',
  NEEDS_CHANGES: 'needs_changes',
  DONE: 'done',
};

const ACTION_STATES = new Set([
  STATES.NO_LABEL,
  STATES.REVIEW_REQUESTED,
  STATES.NEEDS_CHANGES,
  STATES.DONE,
]);

function deriveMrState(mr, { allowedUsers, now, noLabelGraceMs }) {
  const isRelevant = allowedUsers.includes(mr.authorUsername) || allowedUsers.includes(mr.reviewerUsername);
  if (!isRelevant || mr.draft) {
    return { state: STATES.SKIP, responsibleUsername: null };
  }

  const labels = new Set(mr.labels);
  if (labels.has(LABELS.DONE)) {
    return { state: STATES.DONE, responsibleUsername: mr.reviewerUsername };
  }
  if (labels.has(LABELS.NEEDS_CHANGES)) {
    return { state: STATES.NEEDS_CHANGES, responsibleUsername: mr.authorUsername };
  }
  if (labels.has(LABELS.IN_REVIEW)) {
    return { state: STATES.IN_REVIEW, responsibleUsername: null };
  }
  if (labels.has(LABELS.REVIEW_REQUESTED)) {
    return { state: STATES.REVIEW_REQUESTED, responsibleUsername: mr.reviewerUsername };
  }

  const ageMs = now.getTime() - new Date(mr.createdAt).getTime();
  if (ageMs < noLabelGraceMs) {
    return { state: STATES.SKIP, responsibleUsername: null };
  }
  return { state: STATES.NO_LABEL, responsibleUsername: mr.authorUsername };
}

export { LABELS, STATES, ACTION_STATES, deriveMrState };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 9 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/labelState.js test/labelState.test.js
git commit -m "feat: add MR label state machine"
```

---

### Task 4: Notify/reminder decision function

**Files:**
- Create: `src/decision.js`
- Test: `test/decision.test.js`

**Interfaces:**
- Consumes: `ACTION_STATES`, `STATES` from `src/labelState.js`.
- Produces: `decideAction({ derived, previous, now, reminderIntervalMs, isWorkHours }): { type: 'notify_new' | 'notify_reminder' | 'log_transition' | 'none' }` where `derived` is a `deriveMrState` result and `previous` is `{ state, lastReminderAt } | null` read from the store.

- [ ] **Step 1: Write failing tests**

Create `test/decision.test.js`:
```js
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
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'notify_new' });
});

test('new non-action-state MR with no history triggers log_transition', () => {
  const action = decideAction({
    derived: { state: STATES.IN_REVIEW, responsibleUsername: null },
    previous: null,
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'log_transition' });
});

test('state change between two action states triggers notify_new', () => {
  const action = decideAction({
    derived: { state: STATES.DONE, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'notify_new' });
});

test('unchanged action state within reminder interval does nothing', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('unchanged action state past reminder interval inside work hours reminds', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - REMINDER_MS - 1 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'notify_reminder' });
});

test('unchanged action state past reminder interval outside work hours does nothing', () => {
  const action = decideAction({
    derived: { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' },
    previous: { state: STATES.REVIEW_REQUESTED, lastReminderAt: NOW - REMINDER_MS - 1 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: false,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('unchanged non-action state never reminds', () => {
  const action = decideAction({
    derived: { state: STATES.IN_REVIEW, responsibleUsername: null },
    previous: { state: STATES.IN_REVIEW, lastReminderAt: 0 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'none' });
});

test('MR that becomes skip after being tracked triggers one log_transition', () => {
  const action = decideAction({
    derived: { state: STATES.SKIP, responsibleUsername: null },
    previous: { state: STATES.NEEDS_CHANGES, lastReminderAt: NOW - 1000 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'log_transition' });
});

test('MR that stays skip does nothing', () => {
  const action = decideAction({
    derived: { state: STATES.SKIP, responsibleUsername: null },
    previous: { state: STATES.SKIP, lastReminderAt: 0 },
    now: new Date(NOW),
    reminderIntervalMs: REMINDER_MS,
    isWorkHours: true,
  });
  assert.deepEqual(action, { type: 'none' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/decision.js'`

- [ ] **Step 3: Implement decision.js**

Create `src/decision.js`:
```js
import { ACTION_STATES, STATES } from './labelState.js';

function decideAction({ derived, previous, now, reminderIntervalMs, isWorkHours }) {
  const previousState = previous?.state ?? null;
  const isActionState = ACTION_STATES.has(derived.state);

  if (derived.state === STATES.SKIP) {
    if (previousState && previousState !== STATES.SKIP) {
      return { type: 'log_transition' };
    }
    return { type: 'none' };
  }

  if (previousState !== derived.state) {
    return { type: isActionState ? 'notify_new' : 'log_transition' };
  }

  if (isActionState) {
    const lastReminderAt = previous?.lastReminderAt ?? 0;
    if (isWorkHours && now.getTime() - lastReminderAt >= reminderIntervalMs) {
      return { type: 'notify_reminder' };
    }
  }

  return { type: 'none' };
}

export { decideAction };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 9 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/decision.js test/decision.test.js
git commit -m "feat: add notify/reminder decision function"
```

---

### Task 5: JSON file store

**Files:**
- Create: `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createStore(filePath: string): { getMr(key), setMr(key, value), deleteMr(key), getAllMrKeys(), setUser(chatId, gitlabUsername), getChatIdForGitlabUser(gitlabUsername) }`.

- [ ] **Step 1: Write failing tests**

Create `test/store.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function tempStorePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-informer-'));
  return path.join(dir, 'store.json');
}

test('getMr returns null when the store file does not exist yet', () => {
  const store = createStore(tempStorePath());
  assert.equal(store.getMr('1'), null);
});

test('setMr then getMr round-trips a value', () => {
  const store = createStore(tempStorePath());
  store.setMr('1', { state: 'done', lastReminderAt: 123 });
  assert.deepEqual(store.getMr('1'), { state: 'done', lastReminderAt: 123 });
});

test('deleteMr removes an entry', () => {
  const store = createStore(tempStorePath());
  store.setMr('1', { state: 'done', lastReminderAt: 123 });
  store.deleteMr('1');
  assert.equal(store.getMr('1'), null);
});

test('getAllMrKeys lists tracked MR keys', () => {
  const store = createStore(tempStorePath());
  store.setMr('1', { state: 'done', lastReminderAt: 1 });
  store.setMr('2', { state: 'in_review', lastReminderAt: 2 });
  assert.deepEqual(store.getAllMrKeys().sort(), ['1', '2']);
});

test('setUser then getChatIdForGitlabUser round-trips', () => {
  const store = createStore(tempStorePath());
  store.setUser(555, 'alice');
  assert.equal(store.getChatIdForGitlabUser('alice'), 555);
});

test('getChatIdForGitlabUser returns null for an unregistered user', () => {
  const store = createStore(tempStorePath());
  assert.equal(store.getChatIdForGitlabUser('nobody'), null);
});

test('data persists across separate store instances on the same file', () => {
  const filePath = tempStorePath();
  const storeA = createStore(filePath);
  storeA.setMr('1', { state: 'done', lastReminderAt: 1 });

  const storeB = createStore(filePath);
  assert.deepEqual(storeB.getMr('1'), { state: 'done', lastReminderAt: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/store.js'`

- [ ] **Step 3: Implement store.js**

Create `src/store.js`:
```js
import fs from 'node:fs';
import path from 'node:path';

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { mrs: {}, users: {} };
    }
    throw err;
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function createStore(filePath) {
  return {
    getMr(mrKey) {
      return readState(filePath).mrs[mrKey] ?? null;
    },
    setMr(mrKey, value) {
      const state = readState(filePath);
      state.mrs[mrKey] = value;
      writeState(filePath, state);
    },
    deleteMr(mrKey) {
      const state = readState(filePath);
      delete state.mrs[mrKey];
      writeState(filePath, state);
    },
    getAllMrKeys() {
      return Object.keys(readState(filePath).mrs);
    },
    setUser(chatId, gitlabUsername) {
      const state = readState(filePath);
      state.users[String(chatId)] = gitlabUsername;
      writeState(filePath, state);
    },
    getChatIdForGitlabUser(gitlabUsername) {
      const state = readState(filePath);
      const entry = Object.entries(state.users).find(([, username]) => username === gitlabUsername);
      return entry ? Number(entry[0]) : null;
    },
  };
}

export { createStore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 7 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: add JSON file store"
```

---

### Task 6: GitLab API client

**Files:**
- Create: `src/gitlabClient.js`
- Test: `test/gitlabClient.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `mapApiMr(raw): Mr` and `fetchOpenMergeRequests({ baseUrl, token, projectPath, fetchImpl? }): Promise<Mr[]>`, where `Mr` matches the shape consumed by `deriveMrState` in Task 3 (`{ iid, title, url, authorUsername, reviewerUsername, labels, draft, createdAt }`).

- [ ] **Step 1: Write failing tests**

Create `test/gitlabClient.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapApiMr, fetchOpenMergeRequests } from '../src/gitlabClient.js';

test('mapApiMr maps a full raw MR using reviewers', () => {
  const raw = {
    iid: 42,
    title: 'Fix things',
    web_url: 'https://git.example.com/mr/42',
    author: { username: 'alice' },
    reviewers: [{ username: 'bob' }],
    assignees: [{ username: 'carol' }],
    labels: ['готово'],
    draft: false,
    created_at: '2026-08-19T10:00:00Z',
  };
  assert.deepEqual(mapApiMr(raw), {
    iid: 42,
    title: 'Fix things',
    url: 'https://git.example.com/mr/42',
    authorUsername: 'alice',
    reviewerUsername: 'bob',
    labels: ['готово'],
    draft: false,
    createdAt: '2026-08-19T10:00:00Z',
  });
});

test('mapApiMr falls back to assignees when reviewers is absent', () => {
  const raw = {
    iid: 1,
    title: 'T',
    web_url: 'https://git.example.com/mr/1',
    author: { username: 'alice' },
    assignees: [{ username: 'carol' }],
    labels: [],
    work_in_progress: true,
    created_at: '2026-08-19T10:00:00Z',
  };
  const result = mapApiMr(raw);
  assert.equal(result.reviewerUsername, 'carol');
  assert.equal(result.draft, true);
});

test('mapApiMr defaults missing labels and draft flags', () => {
  const raw = {
    iid: 1,
    title: 'T',
    web_url: 'https://git.example.com/mr/1',
    author: { username: 'alice' },
    created_at: '2026-08-19T10:00:00Z',
  };
  const result = mapApiMr(raw);
  assert.deepEqual(result.labels, []);
  assert.equal(result.draft, false);
  assert.equal(result.reviewerUsername, null);
});

test('fetchOpenMergeRequests builds the correct URL and auth header, and maps the response', async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => [
        {
          iid: 1,
          title: 'T',
          web_url: 'https://git.example.com/mr/1',
          author: { username: 'alice' },
          reviewers: [{ username: 'bob' }],
          labels: ['ревью'],
          draft: false,
          created_at: '2026-08-19T10:00:00Z',
        },
      ],
    };
  };

  const mrs = await fetchOpenMergeRequests({
    baseUrl: 'https://git.example.com',
    token: 'secret-token',
    projectPath: 'group/sub group',
    fetchImpl,
  });

  assert.equal(
    capturedUrl,
    'https://git.example.com/api/v4/projects/group%2Fsub%20group/merge_requests?state=opened&scope=all&per_page=100',
  );
  assert.deepEqual(capturedOptions.headers, { 'PRIVATE-TOKEN': 'secret-token' });
  assert.equal(mrs.length, 1);
  assert.equal(mrs[0].reviewerUsername, 'bob');
});

test('fetchOpenMergeRequests throws when the response is not ok', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  await assert.rejects(
    () => fetchOpenMergeRequests({ baseUrl: 'https://git.example.com', token: 't', projectPath: 'g/p', fetchImpl }),
    /GitLab API error: 401 Unauthorized/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/gitlabClient.js'`

- [ ] **Step 3: Implement gitlabClient.js**

Create `src/gitlabClient.js`:
```js
function mapApiMr(raw) {
  return {
    iid: raw.iid,
    title: raw.title,
    url: raw.web_url,
    authorUsername: raw.author?.username ?? null,
    reviewerUsername: raw.reviewers?.[0]?.username ?? raw.assignees?.[0]?.username ?? null,
    labels: raw.labels ?? [],
    draft: Boolean(raw.draft ?? raw.work_in_progress),
    createdAt: raw.created_at,
  };
}

async function fetchOpenMergeRequests({ baseUrl, token, projectPath, fetchImpl = fetch }) {
  const url = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests?state=opened&scope=all&per_page=100`;
  const response = await fetchImpl(url, { headers: { 'PRIVATE-TOKEN': token } });
  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();
  return raw.map(mapApiMr);
}

export { mapApiMr, fetchOpenMergeRequests };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 5 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/gitlabClient.js test/gitlabClient.test.js
git commit -m "feat: add GitLab merge requests client"
```

---

### Task 7: Notification formatting and sending

**Files:**
- Create: `src/notifier.js`
- Test: `test/notifier.test.js`

**Interfaces:**
- Consumes: `STATES` from `src/labelState.js`.
- Produces: `formatStateLabel(state): string`, `buildDmText({ mr, state, isReminder }): string`, `buildGroupText({ mr, state, responsibleUsername, registered }): string`, `createNotifier(bot, groupChatId): { notifyUser(chatId, text): Promise<void>, notifyGroup(text): Promise<void> }`.

- [ ] **Step 1: Write failing tests**

Create `test/notifier.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES } from '../src/labelState.js';
import { formatStateLabel, buildDmText, buildGroupText, createNotifier } from '../src/notifier.js';

const MR = { title: 'Fix things', url: 'https://git.example.com/mr/1' };

test('formatStateLabel returns the Russian label for a known state', () => {
  assert.equal(formatStateLabel(STATES.DONE), 'готово');
});

test('formatStateLabel falls back to the raw state for an unknown value', () => {
  assert.equal(formatStateLabel('mystery'), 'mystery');
});

test('buildDmText for a new action item mentions "Нужно действие"', () => {
  const text = buildDmText({ mr: MR, state: STATES.REVIEW_REQUESTED, isReminder: false });
  assert.match(text, /^Нужно действие/);
  assert.match(text, /возьми MR в ревью/);
  assert.match(text, /Fix things/);
  assert.match(text, /https:\/\/git\.example\.com\/mr\/1/);
});

test('buildDmText for a reminder mentions "Напоминание"', () => {
  const text = buildDmText({ mr: MR, state: STATES.DONE, isReminder: true });
  assert.match(text, /^Напоминание/);
  assert.match(text, /замержи MR/);
});

test('buildGroupText includes status and responsible user', () => {
  const text = buildGroupText({ mr: MR, state: STATES.NEEDS_CHANGES, responsibleUsername: 'alice', registered: true });
  assert.match(text, /Fix things/);
  assert.match(text, /требуются уточнения/);
  assert.match(text, /alice/);
});

test('buildGroupText flags an unregistered responsible user', () => {
  const text = buildGroupText({ mr: MR, state: STATES.DONE, responsibleUsername: 'bob', registered: false });
  assert.match(text, /не зарегистрирован/);
});

test('buildGroupText handles no responsible user', () => {
  const text = buildGroupText({ mr: MR, state: STATES.IN_REVIEW, responsibleUsername: null, registered: true });
  assert.match(text, /—/);
});

test('createNotifier.notifyUser sends via bot.telegram.sendMessage', async () => {
  const calls = [];
  const fakeBot = { telegram: { sendMessage: async (chatId, text) => calls.push([chatId, text]) } };
  const notifier = createNotifier(fakeBot, null);
  await notifier.notifyUser(555, 'hello');
  assert.deepEqual(calls, [[555, 'hello']]);
});

test('createNotifier.notifyGroup is a no-op when groupChatId is null', async () => {
  const calls = [];
  const fakeBot = { telegram: { sendMessage: async (chatId, text) => calls.push([chatId, text]) } };
  const notifier = createNotifier(fakeBot, null);
  await notifier.notifyGroup('hello');
  assert.deepEqual(calls, []);
});

test('createNotifier.notifyGroup sends to the configured group chat', async () => {
  const calls = [];
  const fakeBot = { telegram: { sendMessage: async (chatId, text) => calls.push([chatId, text]) } };
  const notifier = createNotifier(fakeBot, -100999);
  await notifier.notifyGroup('hello');
  assert.deepEqual(calls, [[-100999, 'hello']]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/notifier.js'`

- [ ] **Step 3: Implement notifier.js**

Create `src/notifier.js`:
```js
import { STATES } from './labelState.js';

const STATE_LABELS = {
  [STATES.NO_LABEL]: 'нет лейбла статуса',
  [STATES.REVIEW_REQUESTED]: 'требуется ревью',
  [STATES.IN_REVIEW]: 'ревью',
  [STATES.NEEDS_CHANGES]: 'требуются уточнения',
  [STATES.DONE]: 'готово',
};

const STATE_ACTIONS = {
  [STATES.NO_LABEL]: 'проставь статус MR',
  [STATES.REVIEW_REQUESTED]: 'возьми MR в ревью',
  [STATES.NEEDS_CHANGES]: 'поправь замечания и верни MR на ревью',
  [STATES.DONE]: 'замержи MR',
};

function formatStateLabel(state) {
  return STATE_LABELS[state] ?? state;
}

function buildDmText({ mr, state, isReminder }) {
  const prefix = isReminder ? 'Напоминание' : 'Нужно действие';
  const action = STATE_ACTIONS[state] ?? 'проверь MR';
  return `${prefix}: ${action}\n${mr.title}\n${mr.url}`;
}

function buildGroupText({ mr, state, responsibleUsername, registered }) {
  const status = formatStateLabel(state);
  const who = responsibleUsername
    ? `${responsibleUsername}${registered ? '' : ' (не зарегистрирован в боте)'}`
    : '—';
  return `${mr.title}\n${mr.url}\nСтатус: ${status}\nОтветственный: ${who}`;
}

function createNotifier(bot, groupChatId) {
  return {
    async notifyUser(chatId, text) {
      await bot.telegram.sendMessage(chatId, text);
    },
    async notifyGroup(text) {
      if (!groupChatId) return;
      await bot.telegram.sendMessage(groupChatId, text);
    },
  };
}

export { formatStateLabel, buildDmText, buildGroupText, createNotifier };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 10 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/notifier.js test/notifier.test.js
git commit -m "feat: add notification formatting and sending"
```

---

### Task 8: Telegram user registration (`/start` flow)

**Files:**
- Create: `src/registration.js`
- Test: `test/registration.test.js`

**Interfaces:**
- Consumes: `store.setUser(chatId, gitlabUsername)` from Task 5.
- Produces: `normalizeUsernameInput(text): string`, `registerHandlers(bot, store): void` where `bot` exposes `.start(handler)` and `.on('text', handler)` (the subset of the Telegraf API this module uses).

- [ ] **Step 1: Write failing tests**

Create `test/registration.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsernameInput, registerHandlers } from '../src/registration.js';

test('normalizeUsernameInput trims surrounding whitespace', () => {
  assert.equal(normalizeUsernameInput('  alice  '), 'alice');
});

function createFakeBot() {
  const handlers = {};
  return {
    handlers,
    start(fn) {
      handlers.start = fn;
    },
    on(event, fn) {
      if (event === 'text') handlers.text = fn;
    },
  };
}

function createFakeStore() {
  const calls = [];
  return { calls, setUser: (chatId, username) => calls.push([chatId, username]) };
}

function createFakeCtx(chatId, text) {
  const replies = [];
  return {
    chat: { id: chatId },
    message: text === undefined ? undefined : { text },
    reply: async (msg) => replies.push(msg),
    replies,
  };
}

test('/start greets the user and waits for their GitLab login', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(1);
  await bot.handlers.start(ctx);

  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0], /GitLab/);
  assert.deepEqual(store.calls, []);
});

test('a text message after /start registers the GitLab username', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  await bot.handlers.start(createFakeCtx(1));
  const ctx = createFakeCtx(1, ' alice ');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, [[1, 'alice']]);
  assert.match(ctx.replies[0], /alice/);
});

test('a text message from a chat that never ran /start is ignored', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(2, 'alice');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, []);
  assert.deepEqual(ctx.replies, []);
});

test('a second text message after registration is ignored (awaiting flag cleared)', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  await bot.handlers.start(createFakeCtx(1));
  await bot.handlers.text(createFakeCtx(1, 'alice'));
  const ctx = createFakeCtx(1, 'bob');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, [[1, 'alice']]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/registration.js'`

- [ ] **Step 3: Implement registration.js**

Create `src/registration.js`:
```js
function normalizeUsernameInput(text) {
  return text.trim();
}

function registerHandlers(bot, store) {
  const awaitingChats = new Set();

  bot.start((ctx) => {
    awaitingChats.add(ctx.chat.id);
    return ctx.reply('Привет! Пришли свой логин в GitLab (как в адресе профиля), чтобы получать уведомления по MR.');
  });

  bot.on('text', (ctx) => {
    if (!awaitingChats.has(ctx.chat.id)) return;
    const username = normalizeUsernameInput(ctx.message.text);
    if (!username) {
      return ctx.reply('Логин не может быть пустым, пришли ещё раз.');
    }
    store.setUser(ctx.chat.id, username);
    awaitingChats.delete(ctx.chat.id);
    return ctx.reply(`Готово, записал тебя как "${username}". Буду присылать уведомления по твоим MR.`);
  });
}

export { normalizeUsernameInput, registerHandlers };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 5 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/registration.js test/registration.test.js
git commit -m "feat: add /start GitLab username registration"
```

---

### Task 9: Poll cycle orchestration

**Files:**
- Create: `src/poller.js`
- Test: `test/poller.test.js`

**Interfaces:**
- Consumes: `deriveMrState` (Task 3), `decideAction` (Task 4), `createStore` (Task 5), `isWithinWorkHours` (Task 2), `buildDmText`/`buildGroupText` (Task 7).
- Produces: `runPollCycle({ gitlabClient, store, notifier, config, now }): Promise<void>` where `gitlabClient` exposes `fetchOpenMergeRequests(gitlabConfig)`, `notifier` exposes `notifyUser`/`notifyGroup`, `config` is the object from `loadConfig`, `now` is a `Date`.

- [ ] **Step 1: Write failing tests**

Create `test/poller.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { runPollCycle } from '../src/poller.js';

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
    labels: ['требуется ревью'],
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
  assert.deepEqual(store.getMr('1'), { state: 'review_requested', lastReminderAt: NOON_MOSCOW.getTime(), title: 'Some MR', url: 'https://git.example.com/mr/1' });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/poller.js'`

- [ ] **Step 3: Implement poller.js**

Create `src/poller.js`:
```js
import { deriveMrState } from './labelState.js';
import { decideAction } from './decision.js';
import { isWithinWorkHours } from './workHours.js';
import { buildDmText, buildGroupText } from './notifier.js';

async function runPollCycle({ gitlabClient, store, notifier, config, now }) {
  const mrs = await gitlabClient.fetchOpenMergeRequests(config.gitlab);
  const isWorkHours = isWithinWorkHours(now, config.workHours);
  const seenKeys = new Set();

  for (const mr of mrs) {
    const derived = deriveMrState(mr, {
      allowedUsers: config.allowedUsers,
      now,
      noLabelGraceMs: config.noLabelGraceMs,
    });

    const key = String(mr.iid);
    const previous = store.getMr(key);

    if (derived.state === 'skip' && !previous) {
      continue;
    }
    seenKeys.add(key);

    const action = decideAction({
      derived,
      previous,
      now,
      reminderIntervalMs: config.reminderIntervalMs,
      isWorkHours,
    });

    if (action.type === 'notify_new' || action.type === 'notify_reminder') {
      const chatId = derived.responsibleUsername
        ? store.getChatIdForGitlabUser(derived.responsibleUsername)
        : null;
      if (chatId) {
        await notifier.notifyUser(
          chatId,
          buildDmText({ mr, state: derived.state, isReminder: action.type === 'notify_reminder' }),
        );
      }
      await notifier.notifyGroup(
        buildGroupText({ mr, state: derived.state, responsibleUsername: derived.responsibleUsername, registered: Boolean(chatId) }),
      );
      store.setMr(key, { state: derived.state, lastReminderAt: now.getTime(), title: mr.title, url: mr.url });
    } else if (action.type === 'log_transition') {
      await notifier.notifyGroup(
        buildGroupText({ mr, state: derived.state, responsibleUsername: derived.responsibleUsername, registered: true }),
      );
      store.setMr(key, { state: derived.state, lastReminderAt: previous?.lastReminderAt ?? 0, title: mr.title, url: mr.url });
    }
  }

  for (const key of store.getAllMrKeys()) {
    if (!seenKeys.has(key)) {
      const previous = store.getMr(key);
      store.deleteMr(key);
      if (previous) {
        await notifier.notifyGroup(`MR больше не отслеживается (закрыт/смержен): ${previous.title}\n${previous.url}`);
      }
    }
  }
}

export { runPollCycle };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all previous + 6 new tests)

- [ ] **Step 5: Commit**

```bash
git add src/poller.js test/poller.test.js
git commit -m "feat: add poll cycle orchestration"
```

---

### Task 10: Entrypoint wiring and deployment docs

**Files:**
- Create: `src/index.js`
- Create: `README.md`

**Interfaces:**
- Consumes: `loadConfig` (Task 1), `createStore` (Task 5), `fetchOpenMergeRequests` (Task 6), `createNotifier` (Task 7), `registerHandlers` (Task 8), `runPollCycle` (Task 9).
- Produces: nothing further (top-level process entrypoint).

- [ ] **Step 1: Implement index.js**

Create `src/index.js`:
```js
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { fetchOpenMergeRequests } from './gitlabClient.js';
import { createNotifier } from './notifier.js';
import { registerHandlers } from './registration.js';
import { runPollCycle } from './poller.js';

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}
if (!config.gitlab.token || !config.gitlab.baseUrl || !config.gitlab.projectPath) {
  throw new Error('GITLAB_TOKEN, GITLAB_BASE_URL and GITLAB_PROJECT_PATH must be set');
}
if (config.allowedUsers.length === 0) {
  throw new Error('ALLOWED_GITLAB_USERS must list at least one username');
}

const bot = new Telegraf(config.telegramBotToken);
const store = createStore(config.storePath);
const notifier = createNotifier(bot, config.groupChatId);
const gitlabClient = { fetchOpenMergeRequests };

registerHandlers(bot, store);

async function tick() {
  try {
    await runPollCycle({ gitlabClient, store, notifier, config, now: new Date() });
  } catch (err) {
    console.error('Poll cycle failed:', err);
  }
}

bot.launch();
tick();
setInterval(tick, config.pollIntervalMs);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
```

- [ ] **Step 2: Syntax-check the entrypoint**

Run: `node --check src/index.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests from Tasks 1-9 (46 tests total) still green.

- [ ] **Step 4: Write README.md**

Create `README.md`:
```markdown
# mr-informer

Телеграм-бот, который следит за merge request'ами в одном GitLab-проекте и
подсказывает каждому из двух вайбкодеров, что нужно сделать прямо сейчас
(взять в ревью, поправить замечания, замержить), чтобы сократить лаг
реакции. Полностью read-only по отношению к GitLab — только читает лейблы,
никогда не пишет.

Подробности и обоснование решений — в
`docs/superpowers/specs/2026-08-21-mr-informer-spec.md`.

## Настройка

1. `npm install`
2. Скопировать `.env.example` в `.env` и заполнить:
   - `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather.
   - `GITLAB_TOKEN` — персональный access token с правами только на чтение
     (`read_api`), для self-hosted GitLab `https://git.fix-price.ru`.
   - `GITLAB_PROJECT_PATH` — `android/fixprice_serbia`.
   - `ALLOWED_GITLAB_USERS` — GitLab-логины обоих вайбкодеров через запятую.
   - `GROUP_CHAT_ID` — см. ниже.
3. Создать отдельную Telegram-группу для лога прогресса, добавить туда бота.
4. Отправить любое сообщение в группу, затем открыть в браузере
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` и найти
   `chat.id` этой группы (отрицательное число) — записать в `GROUP_CHAT_ID`.
5. Каждый вайбкодер один раз пишет боту `/start` в личке и присылает свой
   GitLab-логин по запросу бота — так бот узнаёт, куда слать личные
   уведомления.

## Запуск

```bash
npm start
```

## Тесты

```bash
npm test
```

## Деплой на VPS (systemd)

Пример unit-файла `/etc/systemd/system/mr-informer.service`:

```ini
[Unit]
Description=MR Informer Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mr-informer
EnvironmentFile=/opt/mr-informer/.env
ExecStart=/usr/bin/node /opt/mr-informer/src/index.js
Restart=on-failure
RestartSec=5
User=mrinformer

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mr-informer
sudo journalctl -u mr-informer -f
```
```

- [ ] **Step 5: Commit**

```bash
git add src/index.js README.md
git commit -m "feat: wire entrypoint and add deployment docs"
```

---

## Self-Review

**Spec coverage:**
- Поллинг GitLab API раз в 3 минуты, read-only токен → `config.js` (Task 1) + `gitlabClient.js` (Task 6), only `GET`.
- Whitelist по двум логинам, один проект → `deriveMrState`'s `isRelevant` check (Task 3) + `GITLAB_PROJECT_PATH`/`ALLOWED_GITLAB_USERS` config.
- Полная state machine (5 состояний + draft-skip) → `labelState.js` (Task 3).
- Напоминания раз в ~3ч только в рабочее окно 9–19 МСК Пн-Пт → `workHours.js` (Task 2) + `decision.js` (Task 4).
- Немедленное уведомление при смене состояния независимо от часа → `decision.js` `notify_new` path is not gated by `isWorkHours` (Task 4).
- DM — единственный actionable-канал; группа — только лог без меншенов → `notifier.js` (Task 7) + `poller.js` (Task 9) always calls both `notifyUser` (if registered) and `notifyGroup`.
- Регистрация через `/start` с ручным вводом GitLab-логина → `registration.js` (Task 8).
- Немедленное уведомление о существующих action-item при первом запуске → falls out of `previous === null` on first `runPollCycle` against an empty store (Task 9), no special-casing needed.
- Грейс-период 15 минут перед аномалией "нет лейбла" → `noLabelGraceMs` in `deriveMrState` (Task 3).
- JSON-хранилище → `store.js` (Task 5).
- Node.js, простой сервис, VPS/systemd, секреты в `.env` → `package.json`, `.env.example` (Task 1), `README.md` systemd section (Task 10).
- Read-only границы → no write/label/comment call anywhere in `gitlabClient.js`.

**Placeholder scan:** no TBD/TODO, no "add error handling" hand-waves, no "similar to Task N" — every step has full code.

**Type consistency:** `Mr` shape (`iid, title, url, authorUsername, reviewerUsername, labels, draft, createdAt`) matches from Task 6's `mapApiMr` output through Task 3's `deriveMrState`, Task 7's `buildDmText`/`buildGroupText`, and Task 9's `runPollCycle` test fixtures. `derived` shape (`{ state, responsibleUsername }`) matches from Task 3 through Task 4 and Task 9. Store entry shape (`{ state, lastReminderAt, title, url }`) is consistent between Task 5's generic `getMr`/`setMr` and Task 9's usage. Config shape from Task 1's `loadConfig` matches the fields Task 9's `runPollCycle` and Task 10's `index.js` read (`gitlab`, `allowedUsers`, `noLabelGraceMs`, `reminderIntervalMs`, `workHours`, `storePath`, `pollIntervalMs`, `telegramBotToken`, `groupChatId`).
