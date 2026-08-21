function parseCsvList(value) {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntEnv(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function loadConfig(env = process.env) {
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    groupChatId: env.GROUP_CHAT_ID ? Number(env.GROUP_CHAT_ID) : null,
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL,
      token: env.GITLAB_TOKEN,
      projectPath: env.GITLAB_PROJECT_PATH,
    },
    allowedUsers: parseCsvList(env.ALLOWED_GITLAB_USERS),
    pollIntervalMs: parseIntEnv(env.POLL_INTERVAL_MS, 180000),
    reminderIntervalMs: parseIntEnv(env.REMINDER_INTERVAL_MS, 10800000),
    noLabelGraceMs: parseIntEnv(env.NO_LABEL_GRACE_MS, 900000),
    workHours: {
      startHour: parseIntEnv(env.WORK_HOURS_START, 9),
      endHour: parseIntEnv(env.WORK_HOURS_END, 19),
      timeZone: env.WORK_TZ ?? 'Europe/Moscow',
      workDays: parseCsvList(env.WORK_DAYS ?? '1,2,3,4,5').map(Number),
    },
    storePath: env.STORE_PATH ?? './data/store.json',
  };
}

export { parseCsvList, parseIntEnv, loadConfig };
