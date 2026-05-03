# podari-bot (Sber Cloud)

Systemd unit для Telegram-бота `@podaripesniu_bot` на Sber Cloud
(`84.54.59.163`, tailnet `100.126.47.92`).

Аналогичный unit для мини-ПК исторически живёт **только** в `/etc/systemd/system/`
на самой машине (в репо не закоммичен) — путь `/home/alexander/...`,
`User=alexander`, `After=...suno-api.service`. После cutover мини-ПК
disabled, этот unit на cloud — единственный продакшн.

## Зависимости

- `tailscaled.service` — бот ходит на мини-ПК через tailnet (`SUNO_API_BASE=http://100.103.150.29:3000`, `REFRESH_AGENT_URL=http://100.103.150.29:3200`).
- `network-online.target` — перед стартом ждём интернет (для grammY long-poll и OpenRouter).
- На самом cloud НЕТ `suno-api`, `passkey-server`, `rhyme-sidecar`, Chromium — всё это остаётся на мини-ПК и доступно через tailnet.

## .env (специфика cloud)

Должно быть в `/home/user1/projects/moyapesnya/.env`:

```
SUNO_API_BASE=http://100.103.150.29:3000
REFRESH_AGENT_URL=http://100.103.150.29:3200
```

Остальные ключи (TELEGRAM_BOT_TOKEN, OPENROUTER_API_KEY, AI_MODEL и т.д.) —
скопированы с мини-ПК.

## Установка

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163
cd ~/projects/moyapesnya
git pull

sudo cp server-configs/podari-bot/podari-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now podari-bot
sudo systemctl status podari-bot --no-pager
journalctl -u podari-bot -f
```

## Cutover (миграция с мини-ПК → cloud)

1. **На мини-ПК:** `sudo systemctl stop podari-bot && sudo systemctl disable podari-bot` — бот off-line.
2. **На cloud (мгновенно после п.1):** `sudo systemctl enable --now podari-bot`.
3. Smoke: `journalctl -u podari-bot --since "1 min ago"` — нет ERROR; `/ping` в Telegram → ответ.
4. Тестовый заказ от себя — пройдёт все стадии (5 вопросов → AI → SUNO → mp3).

Между шагами 1 и 2 бот недоступен ~5-10s — приемлемо для MVP.

## Откат

```bash
# На cloud:
sudo systemctl stop podari-bot && sudo systemctl disable podari-bot
# На мини-ПК:
sudo systemctl enable --now podari-bot
```

## Логи

```bash
journalctl -u podari-bot -f
journalctl -u podari-bot --since '10 min ago'
```
