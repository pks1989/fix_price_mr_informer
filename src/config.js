function parseIntEnv(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfig(env = process.env) {
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    groupChatId: env.GROUP_CHAT_ID && Number.isFinite(Number(env.GROUP_CHAT_ID)) ? Number(env.GROUP_CHAT_ID) : null,
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL,
      token: env.GITLAB_TOKEN,
      projectPath: env.GITLAB_PROJECT_PATH,
    },
    pollIntervalMs: parseIntEnv(env.POLL_INTERVAL_MS, 180000),
    reminderIntervalMs: parseIntEnv(env.REMINDER_INTERVAL_MS, 1800000),
    noLabelGraceMs: parseIntEnv(env.NO_LABEL_GRACE_MS, 900000),
    storePath: env.STORE_PATH ?? './data/store.json',
  };
}

export { parseIntEnv, loadConfig };
