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
