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
