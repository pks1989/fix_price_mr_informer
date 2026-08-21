# mr-informer

Телеграм-бот, который следит за merge request'ами в одном GitLab-проекте и
подсказывает каждому из двух вайбкодеров, что нужно сделать прямо сейчас
(взять в ревью, поправить замечания, замержить), чтобы сократить лаг
реакции. Полностью read-only по отношению к GitLab — только читает лейблы,
никогда не пишет.

Требуется Node.js >=20.

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
   Важно: делать это нужно ДО первого запуска бота (`npm start`) —
   Telegram отдаёт `getUpdates` только тому, кто ещё не открыл long-polling
   соединение. Если бот уже запущен и поллит API, запрос в браузере вернёт
   `409 Conflict` — в этом случае временно остановите бота (`Ctrl+C` /
   `systemctl stop mr-informer`), заберите `chat.id` и запустите снова.

После того как `GROUP_CHAT_ID` и остальные переменные заполнены, переходите
к разделу «Запуск» ниже и поднимите бота (локально или на VPS) — только
после этого можно выполнять шаг регистрации вайбкодеров.

### Регистрация вайбкодеров

Важно: бот должен быть запущен, прежде чем присылать `/start` — если ещё не
задеплоили на VPS, временно запустите локально командой `npm start`.

Каждый вайбкодер один раз пишет боту `/start` в личке и присылает свой
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

Сначала создать системного пользователя и рабочую директорию:

```bash
sudo useradd --system --home /opt/mr-informer --shell /usr/sbin/nologin mrinformer
sudo mkdir -p /opt/mr-informer
sudo chown mrinformer:mrinformer /opt/mr-informer
```

Скопировать код и `.env` в `/opt/mr-informer`, затем `npm ci --omit=dev`
от имени пользователя `mrinformer` (или `sudo -u mrinformer npm ci --omit=dev`).

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
