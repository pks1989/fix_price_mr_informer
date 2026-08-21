import { STATES } from './labelState.js';

const STATE_LABELS = {
  [STATES.NO_LABEL]: 'нет лейбла статуса',
  [STATES.REVIEW_REQUESTED]: 'требуется ревью',
  [STATES.IN_REVIEW]: 'ревью',
  [STATES.NEEDS_CHANGES]: 'требуются уточнения',
  [STATES.DONE]: 'готово',
  [STATES.SKIP]: 'вне отслеживания',
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
