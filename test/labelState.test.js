import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, STATES, deriveMrState } from '../src/labelState.js';

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
  const mr = baseMr({ draft: true, labels: [LABELS.REVIEW_REQUESTED] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.SKIP, responsibleUsername: null });
});

test('the review-requested label makes the reviewer responsible', () => {
  const mr = baseMr({ labels: [LABELS.REVIEW_REQUESTED] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.REVIEW_REQUESTED, responsibleUsername: 'bob' });
});

test('the in-review label has no responsible person', () => {
  const mr = baseMr({ labels: [LABELS.IN_REVIEW] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.IN_REVIEW, responsibleUsername: null });
});

test('the needs-changes label makes the author responsible', () => {
  const mr = baseMr({ labels: [LABELS.NEEDS_CHANGES] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.NEEDS_CHANGES, responsibleUsername: 'alice' });
});

test('the done label makes the reviewer responsible', () => {
  const mr = baseMr({ labels: [LABELS.DONE] });
  const result = deriveMrState(mr, { allowedUsers: ALLOWED, now: NOW, noLabelGraceMs: 900000 });
  assert.deepEqual(result, { state: STATES.DONE, responsibleUsername: 'bob' });
});

test('conflicting labels resolve by done > needs_changes > in_review > review_requested', () => {
  const mr = baseMr({ labels: [LABELS.REVIEW_REQUESTED, LABELS.DONE] });
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
