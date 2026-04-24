# Архитектура проекта «Подари Песню!»

## Обзор

Telegram-бот для создания и продажи персональных песен на заказ. Пользователь отвечает на 5 вопросов, AI генерирует текст, SUNO создаёт аудиотрек, бот отправляет его в чат.

## Стек технологий

| Компонент | Технология |
|---|---|
| Язык | Node.js 22, ESM (import/export) |
| Telegram бот | grammY 1.30 |
| HTTP клиент | undici |
| WebSocket | ws |
| AI (тексты) | OpenRouter → google/gemini-2.5-pro (reasoning:high) |
| Музыка | SUNO API (self-hosted gcui-art/suno-api) |
| Оплата | Robokassa |
| Туннель | Cloudflare Tunnel (pay.vrodnikah.ru → :8080) |

## Сервер

- **Машина:** мини ПК, IP 192.168.0.128, Debian 13
- **SSH:** `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'`
- **Docker НЕ используется** — systemd сервисы напрямую

## Systemd сервисы на сервере

| Сервис | Описание | Порт |
|---|---|---|
| `podari-bot` | Telegram бот (main process) | — |
| `suno-api` | SUNO proxy, Next.js | :3000 |
| `passkey-server` | HTTP сервер, принимает P1_ токены | :3099 |
| `cloudflared` | Cloudflare Tunnel → :8080 | — |
| `chromium-watchdog.timer` | Проверка Chromium CDP каждые 5 мин (НЕ трогает suno-api) | — |

> ⚠️ `cookie-refresh.timer` и `passkey-refresh.timer` **отключены** (14.04.2026).
> Рестарт suno-api теперь только on-demand: перед генерацией (`ensureTokenAlive`) и при ошибках во время генерации (`handleSunoError`). Проактивные таймеры прерывали polling активных генераций.

## Поток данных (happy path)

```
Пользователь
    │
    ▼
Telegram (@podaripesniu_bot)
    │  5 вопросов: повод → жанр → настроение → голос → пожелания
    ▼
OpenRouter / Gemini Flash Lite
    │  генерирует текст песни (≤100 слов, структура куплет/припев/бридж)
    ▼
Пользователь просматривает текст
    │  может редактировать (AI переделывает)
    ▼
[Опционально] Robokassa — оплата 299 ₽
    │  webhook на pay.vrodnikah.ru/robokassa/result → :8080
    ▼
SUNO API (localhost:3000)
    │  POST /api/custom_generate → polling GET /api/get?ids=...
    │  ждём статус "complete" (до 8 минут)
    ▼
Бот отправляет аудиофайл пользователю
```

## Аутентификация SUNO

**Главная аутентификация — Clerk cookie (`__client`).**
P1_ токен (JWT HS256, ~1900 chars) менее критичен: тест с невалидным P1_ показал, что SUNO принимает запрос. Настоящая проверка идёт через cookie.

### Cookie (src/suno/refresh-cookie.js)
`__client` — httpOnly Clerk cookie, недоступна через `document.cookie`.
Единственный способ получить: `Network.getAllCookies` (CDP) → RDP Chromium (порт 9223).
Записывать ТОЛЬКО 5 essential кук (не все ~45 — иначе "Request Header Fields Too Large"):
`__client`, `__client_uat`, `__client_uat_Jnxw-muT`, `__client_Jnxw-muT`, `suno_device_id`

### RDP Chromium на :9223 — как запускается (обновлено 2026-04-24)
**Источник правды:** `~/.config/autostart/chromium-suno.desktop` запускает chromium при входе пользователя в xRDP-сессию.

Команда запуска (из autostart .desktop):
```
chromium --remote-debugging-port=9223 --remote-allow-origins=* \
         --no-sandbox --disable-gpu --disable-dev-shm-usage \
         --load-extension=/home/alexander/projects/suno-passkey-extension \
         https://suno.com/create
```

**Ключевое:**
- **БЕЗ `--user-data-dir`** → используется дефолтный профиль `~/.config/chromium/Default/`
- В дефолтном профиле живёт Clerk session (`__session`, `__session_Jnxw-muT`) — юзер залогинен в SUNO постоянно
- `~/.config/chromium/` в домашней → переживает reboot (/tmp чистится, home нет)
- `--no-sandbox --disable-gpu --disable-dev-shm-usage` — флаги стабильности под xRDP display `:10`

**Ручной запуск после reboot если autostart не сработал:**
```bash
ssh alexander@192.168.0.128 'bash -c "cat > /tmp/launch-chrome-cdp.sh <<EOF
#!/bin/bash
export DISPLAY=:10
export XAUTHORITY=/home/alexander/.Xauthority
exec chromium --remote-debugging-port=9223 --remote-allow-origins=* \\
  --load-extension=/home/alexander/projects/suno-passkey-extension \\
  --no-first-run --disable-session-crashed-bubble \\
  --no-sandbox --disable-gpu --disable-dev-shm-usage --start-maximized \\
  https://suno.com/create
EOF
chmod +x /tmp/launch-chrome-cdp.sh
setsid /tmp/launch-chrome-cdp.sh </dev/null >/tmp/chromium-default.log 2>&1 &"'
```

**Ключевая ошибка которую я совершил 24.04 (для памяти):** запускал с `--user-data-dir=/tmp/chrome-rdp` создавая ИЗОЛИРОВАННЫЙ пустой профиль → SUNO login слетал → passkey refresh не работал. Правильно — без `--user-data-dir`, дефолтный профиль уже содержит всё что нужно.

**Когда обновляется:**
- Перед каждой генерацией: `ensureTokenAlive` делает 3 пробы get_limit, при 3x 500 **с session error в теле** → refreshCookie() (другой 500 не трогает куку)
- Во время генерации: при HTTP 500 "session id" → `handleSunoError` → refreshCookie()
- Вручную: `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'node -e "import(\"./src/suno/refresh-cookie.js\").then(m=>m.refreshCookie())"'`

### P1_ токен (src/suno/refresh-passkey.js)
CF Turnstile invisible challenge на `/create` — генерирует P1_ через 30-60 сек.
P1_ хранится только в React in-memory state браузера.

**Когда обновляется:** только on-demand при HTTP 422 "Token validation failed":
1. Bot Chromium (CDP :9222) навигирует /create, ждёт 60 сек
2. Заполняет форму реальными данными пользователя (lyrics/tags/title)
3. `Fetch.failRequest` перехватывает generate POST — P1_ из тела, запрос отменён (кредиты не тратятся)
4. POST на passkey-server (:3099) → `suno_passkey.txt`

**Проактивные таймеры отключены** (14.04.2026) — создавали мусорные песни и прерывали polling.

### Поток обработки ошибок генерации
```
ensureTokenAlive()
  ├── 3x get_limit OK       → продолжаем
  └── 3x 500                → refreshCookie() → check → OK/false

generateCustom() — попытка 1
  ├── OK                    → продолжаем
  ├── 500 "session id"      → refreshCookie() → попытка 2
  └── 422 "Token"           → refreshPasskeyToken() → попытка 2

generateCustom() — попытка 2
  ├── OK                    → продолжаем
  ├── 500 "session id"      → refreshCookie() → попытка 3 (финальная)
  └── 422 "Token"           → refreshPasskeyToken() → попытка 3 (финальная)
```

## Webhook / оплата

- Cloudflare Tunnel: `pay.vrodnikah.ru` → `localhost:8080`
- Robokassa Result URL: `POST /robokassa/result` — подтверждение оплаты (server-to-server)
- После подтверждения: автоматически запускается генерация песни
- PAYWALL_ENABLED=true, ROBOKASSA_TEST_MODE=true (тестовый режим)
