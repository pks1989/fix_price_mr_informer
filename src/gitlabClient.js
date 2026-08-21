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
  if (!Array.isArray(raw)) {
    throw new Error('GitLab API error: unexpected response shape (expected an array)');
  }
  return raw.map(mapApiMr);
}

async function fetchCurrentUser({ baseUrl, token, fetchImpl = fetch }) {
  const url = `${baseUrl}/api/v4/user`;
  const response = await fetchImpl(url, { headers: { 'PRIVATE-TOKEN': token } });
  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();
  if (!raw?.username) {
    throw new Error('GitLab API error: unexpected response shape (expected a user with a username)');
  }
  return { username: raw.username };
}

export { mapApiMr, fetchOpenMergeRequests, fetchCurrentUser };
