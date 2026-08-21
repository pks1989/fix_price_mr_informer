import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHandlers } from '../src/registration.js';

function createFakeBot() {
  const handlers = {};
  return {
    handlers,
    start(fn) {
      handlers.start = fn;
    },
  };
}

function createFakeStore() {
  const calls = [];
  return { calls, setUser: (chatId, username) => calls.push([chatId, username]) };
}

function createFakeCtx(chatId, chatType = 'private') {
  const replies = [];
  return {
    chat: { id: chatId, type: chatType },
    reply: async (msg) => replies.push(msg),
    replies,
  };
}

test('/start registers the chat against the resolved GitLab username', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store, 'kpershin');

  const ctx = createFakeCtx(1);
  await bot.handlers.start(ctx);

  assert.deepEqual(store.calls, [[1, 'kpershin']]);
  assert.match(ctx.replies[0], /kpershin/);
});

test('/start is ignored in a non-private (group) chat', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store, 'kpershin');

  const ctx = createFakeCtx(999, 'group');
  await bot.handlers.start(ctx);

  assert.deepEqual(ctx.replies, []);
  assert.deepEqual(store.calls, []);
});
