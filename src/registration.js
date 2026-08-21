function registerHandlers(bot, store, gitlabUsername) {
  bot.start((ctx) => {
    if (ctx.chat.type !== 'private') return;

    const claimedChatId = store.getChatIdForGitlabUser(gitlabUsername);
    if (claimedChatId !== null && claimedChatId !== ctx.chat.id) {
      return ctx.reply('Этот бот уже привязан к другому Telegram-аккаунту.');
    }

    store.setUser(ctx.chat.id, gitlabUsername);
    return ctx.reply(`Готово, записал тебя как "${gitlabUsername}". Буду присылать уведомления по твоим MR.`);
  });
}

export { registerHandlers };
