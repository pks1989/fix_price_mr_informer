import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntEnv, loadConfig } from '../src/config.js';

test('parseIntEnv parses valid integers and falls back otherwise', () => {
  assert.equal(parseIntEnv('42', 0), 42);
  assert.equal(parseIntEnv('not-a-number', 7), 7);
  assert.equal(parseIntEnv(undefined, 7), 7);
});

test('loadConfig reads and normalizes environment variables', () => {
  const config = loadConfig({
    TELEGRAM_BOT_TOKEN: 'tg-token',
    GITLAB_BASE_URL: 'https://git.example.com',
    GITLAB_TOKEN: 'gl-token',
    GITLAB_PROJECT_PATH: 'group/project',
    GROUP_CHAT_ID: '-100123',
    POLL_INTERVAL_MS: '60000',
    REMINDER_INTERVAL_MS: '3600000',
    NO_LABEL_GRACE_MS: '60000',
    STORE_PATH: './data/store.json',
  });

  assert.equal(config.telegramBotToken, 'tg-token');
  assert.equal(config.groupChatId, -100123);
  assert.equal(config.gitlab.projectPath, 'group/project');
  assert.equal(config.pollIntervalMs, 60000);
  assert.equal(config.reminderIntervalMs, 3600000);
  assert.equal(config.noLabelGraceMs, 60000);
});

test('loadConfig applies defaults when optional vars are missing', () => {
  const config = loadConfig({});
  assert.equal(config.pollIntervalMs, 180000);
  assert.equal(config.reminderIntervalMs, 1800000);
  assert.equal(config.noLabelGraceMs, 900000);
  assert.equal(config.groupChatId, null);
});
