# rdp-chromium-xvfb

**Автономный** chromium на виртуальном X server (Xvfb) для CDP `:9223` — SUNO passkey/cookie refresh.

## Зачем

Chromium на xRDP display `:10` умирает при каждом disconnect RDP. User уходит / выключает Windows / network flaps — xRDP session ends, chromium dies, bot не может делать refresh.

**Фикс:** chromium живёт в Xvfb — virtual X server, не привязан к user session. Работает 24/7.

## Как работает

```
┌──────────────────────────────────────┐
│ systemd rdp-chromium-xvfb.service   │ Type=simple, Restart=always
├──────────────────────────────────────┤
│ start-rdp-chromium-xvfb.sh          │
│   1. pgrep Xvfb :99 — уже есть?     │
│      нет → Xvfb :99 -screen 0 1920x1080x24 &
│   2. curl :9223 — chromium живой?   │
│      да → exit 0                     │
│      нет → exec chromium ...         │
└──────────────────────────────────────┘
         │
         ▼ DISPLAY=:99
┌──────────────────────────────────────┐
│ chromium (default profile)           │
│   --remote-debugging-port=9223       │
│   --load-extension=suno-passkey...   │
│   https://suno.com/create            │
└──────────────────────────────────────┘
         │ CDP (:9223)
         ▼
┌──────────────────────────────────────┐
│ podari-bot                           │
│   src/suno/refresh-cookie.js         │
│   src/suno/refresh-passkey.js        │
└──────────────────────────────────────┘
```

## Зависимости

- `Xvfb` — `sudo apt install xvfb`
- `chromium` (уже установлен)
- `~/.config/chromium/Default/` с SUNO Clerk `__session` (залогинен через обычный chromium один раз)
- `/run/user/1000/bus` DBus — создаётся при linger login

## Установка

```bash
sudo apt install -y xvfb

cp start-rdp-chromium-xvfb.sh /home/alexander/projects/
chmod +x /home/alexander/projects/start-rdp-chromium-xvfb.sh

sudo cp rdp-chromium-xvfb.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rdp-chromium-xvfb.service

# Disable старый xRDP-based watchdog если был
sudo systemctl disable --now chromium-rdp-watchdog.timer 2>/dev/null || true

# Verify
curl -sS http://127.0.0.1:9223/json/version
```

## Преимущества

- ✅ Работает без user connection к серверу
- ✅ Не зависит от xRDP (который умирает при каждом disconnect)
- ✅ Не зависит от GPU (Xvfb — soft rendering)
- ✅ `systemd Restart=always` поднимает chromium после crashes за 10 сек
- ✅ Дефолтный профиль с __session — никаких re-login'ов

## Посмотреть окно chromium (если нужно)

Chromium невидим (Xvfb — headless X). Варианты attach:

**Через VNC:**
```bash
sudo apt install x11vnc
x11vnc -display :99 -forever -nopw -rfbport 5900 &
# на Windows — VNC viewer → 192.168.0.128:5900
```

**Через скриншот:**
```bash
sudo apt install imagemagick
DISPLAY=:99 import -window root /tmp/chrome.png
scp alexander@192.168.0.128:/tmp/chrome.png ./
```

## Старый watchdog (server-configs/chromium-rdp-watchdog/) — deprecated

Был workaround до перехода на Xvfb. Disabled. Можно удалить `/etc/systemd/system/chromium-rdp-watchdog.{service,timer}` окончательно.
