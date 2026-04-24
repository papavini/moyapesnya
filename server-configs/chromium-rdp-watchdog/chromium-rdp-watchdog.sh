#!/bin/bash
# Watchdog для RDP Chromium с CDP :9223 (для SUNO passkey/cookie refresh).
#
# Вызывается из systemd timer каждые 30 секунд. Если CDP не отвечает —
# перезапускает chromium на xRDP display :10 с дефолтным профилем
# (~/.config/chromium/Default/, где живёт Clerk __session).
#
# Установка: см. server-configs/chromium-rdp-watchdog/README.md.

if curl -s --max-time 3 http://127.0.0.1:9223/json/version > /dev/null 2>&1; then
    exit 0
fi

echo "[rdp-watchdog] $(date -Iseconds) — :9223 down, relaunching"

# Убиваем любые полу-мёртвые chromium-процессы на этом CDP порту
pkill -9 -f 'remote-debugging-port=9223' 2>/dev/null
sleep 3

# Env нужны для DBus, иначе chromium падает через ~30-45 сек с
# "Failed to connect to the bus: Could not parse server address"
export DISPLAY=:10
export XAUTHORITY=/home/alexander/.Xauthority
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"

# setsid: процесс в своей сессии, не убивается когда systemd завершает unit
setsid nohup chromium \
    --remote-debugging-port=9223 \
    --remote-allow-origins=* \
    --load-extension=/home/alexander/projects/suno-passkey-extension \
    https://suno.com/create \
    </dev/null >/tmp/chromium-rdp-watchdog.log 2>&1 &

sleep 8

if curl -s --max-time 3 http://127.0.0.1:9223/json/version > /dev/null 2>&1; then
    echo "[rdp-watchdog] $(date -Iseconds) — :9223 restored"
else
    echo "[rdp-watchdog] $(date -Iseconds) — FAILED to relaunch"
fi
