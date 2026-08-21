import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { fetchOpenMergeRequests } from './gitlabClient.js';
import { createNotifier } from './notifier.js';
import { registerHandlers } from './registration.js';
import { runPollCycle } from './poller.js';

const config = loadConfig();

if (!config.telegramBotToken) {
  throw new Error('TELEGRAM_BOT_TOKEN is not set');
}
if (!config.gitlab.token || !config.gitlab.baseUrl || !config.gitlab.projectPath) {
  throw new Error('GITLAB_TOKEN, GITLAB_BASE_URL and GITLAB_PROJECT_PATH must be set');
}
if (config.allowedUsers.length === 0) {
  throw new Error('ALLOWED_GITLAB_USERS must list at least one username');
}

const bot = new Telegraf(config.telegramBotToken);
const store = createStore(config.storePath);
const notifier = createNotifier(bot, config.groupChatId);
const gitlabClient = { fetchOpenMergeRequests };

registerHandlers(bot, store);

async function tick() {
  try {
    await runPollCycle({ gitlabClient, store, notifier, config, now: new Date() });
  } catch (err) {
    console.error('Poll cycle failed:', err);
  }
}

bot.launch();
tick();
setInterval(tick, config.pollIntervalMs);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
