import { ACTION_STATES, STATES } from './labelState.js';

function decideAction({ derived, previous, now, reminderIntervalMs }) {
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
    if (now.getTime() - lastReminderAt >= reminderIntervalMs) {
      return { type: 'notify_reminder' };
    }
  }

  return { type: 'none' };
}

export { decideAction };
