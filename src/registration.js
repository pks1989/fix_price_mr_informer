function registerHandlers(bot, store, gitlabUsername) {
  bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return;
    store.setUser(ctx.chat.id, gitlabUsername);
    return ctx.reply(`Готово, записал тебя как "${gitlabUsername}". Буду присылать уведомления по твоим MR.`);
  });
}

export { registerHandlers };
