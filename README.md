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

Каждый, кто разворачивает этот бот у себя, заводит **своего** Telegram-бота
(свой токен через @BotFather) и **свой** `.env` — они не шарятся. Если вас
двое и каждый поднимает бота на своей машине, это нормально: оба инстанса
независимо читают один и тот же GitLab-проект и шлют личные уведомления
каждый своему владельцу.

1. `npm install`
2. Скопировать `.env.example` в `.env` и заполнить:
   - `TELEGRAM_BOT_TOKEN` — токен **вашего собственного** бота от @BotFather
     (не общий с другими — у каждого деплоя свой).
   - `GITLAB_TOKEN` — ваш персональный access token с правами только на
     чтение (`read_api`), для self-hosted GitLab `https://git.fix-price.ru`.
   - `GITLAB_PROJECT_PATH` — `android/fixprice_serbia`.
   - `ALLOWED_GITLAB_USERS` — GitLab-логины обоих вайбкодеров через запятую
     (одинаково для всех инстансов — по этому списку бот решает, какие MR
     вообще отслеживать).
   - `GROUP_CHAT_ID` — см. ниже. Если инстансов несколько (по одному на
     человека), заполняйте эту переменную только в ОДНОМ из них — иначе лог
     прогресса в группе задвоится, так как оба бота будут писать про одни и
     те же переходы статусов.
3. Создать отдельную Telegram-группу для лога прогресса, добавить туда бота
   (нужно только тому инстансу, который будет вести лог).
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

## Важно: GitLab за корпоративным VPN

`git.fix-price.ru` доступен не с любого сервера — он фильтрует доступ на
уровне edge/WAF, и случайный VPS (например, дешёвый хостинг) скорее всего
получит `403 Forbidden` даже на главную страницу, без какой-либо связи с
токеном или правами доступа. Деплоить бота нужно на машине, у которой и так
есть доступ к `git.fix-price.ru` — обычно это ваш рабочий ноутбук/десктоп.
Быстрая проверка перед деплоем:

```bash
curl -I https://git.fix-price.ru
```

Если видите `302` на `/users/sign_in` — всё в порядке, доступ есть.
Если `403 Forbidden` от `Angie` — эта машина не подходит.

## Деплой на своей машине (systemd --user, без root)

Проще всего для рабочего ноутбука/десктопа — не нужен `sudo`. Из корня
проекта:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/mr-informer.service << UNIT
[Unit]
Description=MR Informer Telegram Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
EnvironmentFile=$(pwd)/.env
ExecStart=$(which node) $(pwd)/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now mr-informer
loginctl enable-linger "$USER"   # чтобы бот жил и после выхода из сессии
```

Управление:

```bash
systemctl --user status mr-informer
systemctl --user stop mr-informer
systemctl --user start mr-informer
systemctl --user restart mr-informer
journalctl --user -u mr-informer -f
```

## Деплой на VPS (systemd, с root)

Только если у самого VPS есть доступ к `git.fix-price.ru` (см. выше).
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
