import { ACTION_STATES, deriveMrState } from './labelState.js';
import { decideAction } from './decision.js';
import { buildDmText, buildGroupText } from './notifier.js';

async function safeSend(sendFn, context) {
  try {
    await sendFn();
  } catch (err) {
    console.error(`Telegram send failed (${context}):`, err.message);
  }
}

async function runPollCycle({ gitlabClient, store, notifier, config, now }) {
  const mrs = await gitlabClient.fetchOpenMergeRequests(config.gitlab);
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

    const chatId = derived.responsibleUsername
      ? store.getChatIdForGitlabUser(derived.responsibleUsername)
      : null;

    // The responsible person wasn't registered yet when this state was first
    // announced. Deliver the pending DM the moment they register, without
    // waiting for the reminder interval and without re-spamming the group.
    const pendingDmCatchUp = Boolean(
      previous
      && previous.state === derived.state
      && ACTION_STATES.has(derived.state)
      && previous.dmDelivered === false
      && chatId,
    );

    if (pendingDmCatchUp) {
      await safeSend(
        () => notifier.notifyUser(chatId, buildDmText({ mr, state: derived.state, isReminder: false })),
        `DM to ${derived.responsibleUsername} for MR ${key}`,
      );
      store.setMr(key, { ...previous, dmDelivered: true });
      continue;
    }

    const action = decideAction({
      derived,
      previous,
      now,
      reminderIntervalMs: config.reminderIntervalMs,
    });

    if (action.type === 'notify_new' || action.type === 'notify_reminder') {
      if (chatId) {
        await safeSend(
          () => notifier.notifyUser(
            chatId,
            buildDmText({ mr, state: derived.state, isReminder: action.type === 'notify_reminder' }),
          ),
          `DM to ${derived.responsibleUsername} for MR ${key}`,
        );
      }
      await safeSend(
        () => notifier.notifyGroup(
          buildGroupText({ mr, state: derived.state, responsibleUsername: derived.responsibleUsername, registered: Boolean(chatId) }),
        ),
        `group log for MR ${key}`,
      );
      store.setMr(key, { state: derived.state, lastReminderAt: now.getTime(), title: mr.title, url: mr.url, dmDelivered: Boolean(chatId) });
    } else if (action.type === 'log_transition') {
      const registered = Boolean(chatId);
      await safeSend(
        () => notifier.notifyGroup(
          buildGroupText({ mr, state: derived.state, responsibleUsername: derived.responsibleUsername, registered }),
        ),
        `group log for MR ${key}`,
      );
      store.setMr(key, { state: derived.state, lastReminderAt: previous?.lastReminderAt ?? 0, title: mr.title, url: mr.url, dmDelivered: previous?.dmDelivered ?? true });
    }
  }

  for (const key of store.getAllMrKeys()) {
    if (!seenKeys.has(key)) {
      const previous = store.getMr(key);
      store.deleteMr(key);
      if (previous) {
        await safeSend(
          () => notifier.notifyGroup(`MR больше не отслеживается (закрыт/смержен): ${previous.title}\n${previous.url}`),
          `cleanup log for MR ${key}`,
        );
      }
    }
  }
}

export { runPollCycle };
