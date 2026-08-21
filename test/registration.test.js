import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsernameInput, registerHandlers } from '../src/registration.js';

test('normalizeUsernameInput trims surrounding whitespace', () => {
  assert.equal(normalizeUsernameInput('  alice  '), 'alice');
});

function createFakeBot() {
  const handlers = {};
  return {
    handlers,
    start(fn) {
      handlers.start = fn;
    },
    on(event, fn) {
      if (event === 'text') handlers.text = fn;
    },
  };
}

function createFakeStore() {
  const calls = [];
  return { calls, setUser: (chatId, username) => calls.push([chatId, username]) };
}

function createFakeCtx(chatId, text, chatType = 'private') {
  const replies = [];
  return {
    chat: { id: chatId, type: chatType },
    message: text === undefined ? undefined : { text },
    reply: async (msg) => replies.push(msg),
    replies,
  };
}

test('/start greets the user and waits for their GitLab login', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(1);
  await bot.handlers.start(ctx);

  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0], /GitLab/);
  assert.deepEqual(store.calls, []);
});

test('a text message after /start registers the GitLab username', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  await bot.handlers.start(createFakeCtx(1));
  const ctx = createFakeCtx(1, ' alice ');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, [[1, 'alice']]);
  assert.match(ctx.replies[0], /alice/);
});

test('a text message from a chat that never ran /start is ignored', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(2, 'alice');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, []);
  assert.deepEqual(ctx.replies, []);
});

test('a second text message after registration is ignored (awaiting flag cleared)', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  await bot.handlers.start(createFakeCtx(1));
  await bot.handlers.text(createFakeCtx(1, 'alice'));
  const ctx = createFakeCtx(1, 'bob');
  await bot.handlers.text(ctx);

  assert.deepEqual(store.calls, [[1, 'alice']]);
});

test('/start is ignored in a non-private (group) chat', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(999, undefined, 'group');
  await bot.handlers.start(ctx);

  assert.deepEqual(ctx.replies, []);
  assert.deepEqual(store.calls, []);
});

test('a text message in a non-private (group) chat is ignored', async () => {
  const bot = createFakeBot();
  const store = createFakeStore();
  registerHandlers(bot, store);

  const ctx = createFakeCtx(999, 'alice', 'group');
  await bot.handlers.text(ctx);

  assert.deepEqual(ctx.replies, []);
  assert.deepEqual(store.calls, []);
});
