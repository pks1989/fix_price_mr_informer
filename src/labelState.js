const LABELS = {
  REVIEW_REQUESTED: 'Ожидает ревью',
  IN_REVIEW: 'Ревью',
  NEEDS_CHANGES: 'Требуются уточнения',
  DONE: 'Готово',
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
