# mr-informer

Телеграм-бот, который следит за merge request'ами в одном GitLab-проекте и
подсказывает каждому из двух вайбкодеров, что нужно сделать прямо сейчас
(взять в ревью, поправить замечания, замержить), чтобы сократить лаг
реакции. Полностью read-only по отношению к GitLab — только читает лейблы,
никогда не пишет.

Подробности и обоснование решений — в
`docs/superpowers/specs/2026-08-21-mr-informer-spec.md`.

## Настройка

1. `npm install`
2. Скопировать `.env.example` в `.env` и заполнить:
   - `TELEGRAM_BOT_TOKEN` — токен бота от @BotFather.
   - `GITLAB_TOKEN` — персональный access token с правами только на чтение
     (`read_api`), для self-hosted GitLab `https://git.fix-price.ru`.
   - `GITLAB_PROJECT_PATH` — `android/fixprice_serbia`.
   - `ALLOWED_GITLAB_USERS` — GitLab-логины обоих вайбкодеров через запятую.
   - `GROUP_CHAT_ID` — см. ниже.
3. Создать отдельную Telegram-группу для лога прогресса, добавить туда бота.
4. Отправить любое сообщение в группу, затем открыть в браузере
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates` и найти
   `chat.id` этой группы (отрицательное число) — записать в `GROUP_CHAT_ID`.
5. Каждый вайбкодер один раз пишет боту `/start` в личке и присылает свой
   GitLab-логин по запросу бота — так бот узнаёт, куда слать личные
   уведомления.

## Запуск

```bash
npm start
```

## Тесты

```bash
npm test
```

## Деплой на VPS (systemd)

Пример unit-файла `/etc/systemd/system/mr-informer.service`:

```ini
[Unit]
Description=MR Informer Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/mr-informer
EnvironmentFile=/opt/mr-informer/.env
ExecStart=/usr/bin/node /opt/mr-informer/src/index.js
Restart=on-failure
RestartSec=5
User=mrinformer

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mr-informer
sudo journalctl -u mr-informer -f
```
