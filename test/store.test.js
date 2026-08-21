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
