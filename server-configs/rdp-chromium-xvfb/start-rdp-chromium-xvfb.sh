#!/bin/bash
# Автономный запуск chromium на виртуальном Xvfb :99 для CDP :9223.
# НЕ зависит от xRDP session — bot работает круглосуточно без user connection.
# Вчерашнее предположение про "нестабильность xRDP" ошибочно: реальная проблема
# в том что chromium на xRDP display :10 умирает при каждом disconnect RDP.
# Теперь chromium на Xvfb :99 — отвязан от user session вообще.

set -e

# 1. Xvfb уже запущен?
if ! pgrep -f 'Xvfb :99' > /dev/null; then
    echo "[xvfb-chromium] starting Xvfb :99"
    Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
    sleep 2
fi

# 2. Chromium уже на :9223? (exit 0 если да — systemd Restart=always вернётся сюда)
if curl -s --max-time 3 http://127.0.0.1:9223/json/version > /dev/null 2>&1; then
    echo "[xvfb-chromium] :9223 already live"
    exit 0
fi

# 3. Запуск chromium на :99 с дефолтным профилем (~/.config/chromium/Default/)
#    — там живёт Clerk __session для SUNO (не теряется, home-persistent)
export DISPLAY=:99
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"

exec chromium \
    --remote-debugging-port=9223 \
    --remote-allow-origins=* \
    --load-extension=/home/alexander/projects/suno-passkey-extension \
    --no-first-run \
    --disable-session-crashed-bubble \
    https://suno.com/create
