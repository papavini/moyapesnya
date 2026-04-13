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
| AI (тексты) | OpenRouter → google/gemini-3.1-flash-lite-preview |
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
| `cookie-refresh.timer` | Обновление Clerk/session cookies каждые 25 мин | — |
| `chromium-watchdog.timer` | Проверка Chromium каждые 5 мин | — |

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

SUNO требует Passkey (P1_ токен, JWT HS256, ~1900 chars, живёт ~30 мин):

**Откуда берётся P1_:**
- CF Turnstile invisible challenge на странице `/create` — генерирует P1_ через 30-60 сек после загрузки
- P1_ хранится только в React in-memory state браузера — НЕ в cookies, НЕ в localStorage, НЕ в сети

**Как бот получает P1_ (src/suno/refresh-passkey.js):**
1. RDP Chromium запущен на сервере с реальной сессией sonarliktor (CDP порт 9223)
2. CDP навигируем на `https://suno.com/create`, ждём **60 секунд** (CF Turnstile завершает проверку)
3. Заполняем форму через React fiber, кликаем Create
4. `Fetch.failRequest` перехватывает generate POST — читаем P1_ из тела, отменяем запрос (кредиты не тратятся)
5. POST токен на `passkey-server` (:3099) → он сохраняет в `suno_passkey.txt` и рестартует suno-api

**Расписание обновления (src/index.js):**
- При старте бота через 10 сек
- Затем каждые 25 мин (до истечения 30-мин окна)

**При 422 от SUNO:**
- `client.js` вызывает `refreshPasskeyToken()`, ждёт 8 сек, повторяет запрос

**Ручное восстановление** (если авто-refresh не помог):
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && node /tmp/get_p1_hardreload.mjs'
```

## Webhook / оплата

- Cloudflare Tunnel: `pay.vrodnikah.ru` → `localhost:8080`
- Robokassa Result URL: `POST /robokassa/result` — подтверждение оплаты (server-to-server)
- После подтверждения: автоматически запускается генерация песни
- PAYWALL_ENABLED=true, ROBOKASSA_TEST_MODE=true (тестовый режим)
