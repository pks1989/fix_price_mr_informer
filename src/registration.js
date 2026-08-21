function normalizeUsernameInput(text) {
  return text.trim();
}

function registerHandlers(bot, store) {
  const awaitingChats = new Set();

  bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return;
    awaitingChats.add(ctx.chat.id);
    return ctx.reply('Привет! Пришли свой логин в GitLab (как в адресе профиля), чтобы получать уведомления по MR.');
  });

  bot.on('text', (ctx) => {
    if (ctx.chat.type !== 'private') return;
    if (!awaitingChats.has(ctx.chat.id)) return;
    const username = normalizeUsernameInput(ctx.message.text);
    if (!username) {
      return ctx.reply('Логин не может быть пустым, пришли ещё раз.');
    }
    store.setUser(ctx.chat.id, username);
    awaitingChats.delete(ctx.chat.id);
    return ctx.reply(`Готово, записал тебя как "${username}". Буду присылать уведомления по твоим MR.`);
  });
}

export { normalizeUsernameInput, registerHandlers };
