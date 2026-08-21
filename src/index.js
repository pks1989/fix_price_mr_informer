import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { fetchOpenMergeRequests, fetchCurrentUser } from './gitlabClient.js';
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

let myGitlabUsername;
try {
  const me = await fetchCurrentUser({ baseUrl: config.gitlab.baseUrl, token: config.gitlab.token });
  myGitlabUsername = me.username;
} catch (err) {
  console.error('Failed to resolve the GitLab user for GITLAB_TOKEN:', err.message);
  process.exit(1);
}

const bot = new Telegraf(config.telegramBotToken);
const store = createStore(config.storePath);
const notifier = createNotifier(bot, config.groupChatId);
const gitlabClient = { fetchOpenMergeRequests };

registerHandlers(bot, store, myGitlabUsername);

async function tick() {
  try {
    await runPollCycle({ gitlabClient, store, notifier, config, now: new Date() });
  } catch (err) {
    console.error('Poll cycle failed:', err);
  }
}

bot.launch().catch((err) => {
  console.error('Telegram launch failed:', err);
  process.exit(1);
});
tick();
const pollTimer = setInterval(tick, config.pollIntervalMs);

function shutdown(signal) {
  clearInterval(pollTimer);
  bot.stop(signal);
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
