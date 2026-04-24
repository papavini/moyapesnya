# chromium-rdp-watchdog

Watchdog systemd-сервис + таймер, который поддерживает **RDP Chromium на CDP `:9223`** живым.

## Зачем

`:9223` chromium нужен для refresh SUNO auth (cookie + P1_ passkey) — см. `docs/architecture.md`. На xRDP display `:10` chromium нестабилен (GPU / DBus crashes каждые ~45 сек). Без watchdog любой краш → бот не может обновить токены при 422 → «не удалось создать песню».

## Поведение

- Timer запускается через 1 минуту после boot, потом каждые **30 секунд**.
- Service проверяет `http://127.0.0.1:9223/json/version`.
- Если CDP **жив** → exit 0.
- Если **мёртв** → kill процессы с флагом `--remote-debugging-port=9223`, relaunch chromium на `DISPLAY=:10` с дефолтным профилем (`~/.config/chromium/Default/` содержит `__session` Clerk).
- Запуск через `setsid` — процесс переживает SIGTERM oneshot unit'а.

**Максимальный downtime:** ~38 сек (30 сек timer + 8 сек relaunch). Для пассивного use case это приемлемо: бот трогает `:9223` только при 422 раз в 30-60 мин.

## Установка на новом сервере

```bash
# 1. Script
sudo cp chromium-rdp-watchdog.sh /home/alexander/projects/
sudo chmod +x /home/alexander/projects/chromium-rdp-watchdog.sh

# 2. Systemd unit + timer
sudo cp chromium-rdp-watchdog.service /etc/systemd/system/
sudo cp chromium-rdp-watchdog.timer /etc/systemd/system/

# 3. Enable + start
sudo systemctl daemon-reload
sudo systemctl enable --now chromium-rdp-watchdog.timer

# 4. Verify
systemctl list-timers chromium-rdp-watchdog.timer --no-pager
sudo journalctl -u chromium-rdp-watchdog.service --no-pager -n 20
curl -sS http://127.0.0.1:9223/json/version
```

## Требования

- User `alexander` с активной xRDP session (DISPLAY=:10, XAUTHORITY=~/.Xauthority)
- Chromium default profile `~/.config/chromium/Default/` с валидной SUNO Clerk session
- DBus session bus at `/run/user/1000/bus`
- loginctl linger **рекомендован** чтобы user session жила без SSH/xRDP login

## Будущие улучшения

- Xvfb-based alternative чтобы chromium жил без xRDP session вообще (полная автономность после reboot без RDP login)
- `loginctl enable-linger alexander` + user-level systemd unit (равнозначно, легче)
