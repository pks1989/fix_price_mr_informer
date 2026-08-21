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
