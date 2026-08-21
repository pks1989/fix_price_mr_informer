# mr-informer

Телеграм-бот, который следит за merge request'ами в одном GitLab-проекте и
подсказывает каждому из двух вайбкодеров, что нужно сделать прямо сейчас
(взять в ревью, поправить замечания, замержить), чтобы сократить лаг
реакции. Полностью read-only по отношению к GitLab.

Требуется Node.js >=20. Подробности и обоснование решений —
`docs/superpowers/specs/2026-08-21-mr-informer-spec.md`.

## Установка

```bash
git clone https://github.com/pks1989/fix_price_mr_informer.git
cd fix_price_mr_informer
npm install
cp .env.example .env
```

Заполнить `.env`:

- `TELEGRAM_BOT_TOKEN` — токен своего бота от @BotFather.
- `GITLAB_TOKEN` — личный access token с правом только на чтение
  (`read_api`) для `https://git.fix-price.ru`.
- `GITLAB_PROJECT_PATH` — `android/fixprice_serbia`.

## Запуск

```bash
npm start
```

Затем один раз написать боту `/start` в личке — бот сам по токену узнаёт
свой GitLab-логин и запоминает, куда слать уведомления.

## Автозапуск (systemd --user, без root)

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
loginctl enable-linger "$USER"
```

Управление: `systemctl --user {status,stop,start,restart} mr-informer`,
логи — `journalctl --user -u mr-informer -f`.

## Тесты

```bash
npm test
```
