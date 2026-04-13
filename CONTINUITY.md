# Continuity Ledger

## Goal
Telegram-бот «Подари Песню!» (@podaripesniu_bot) — продажа персональных песен через SUNO.
Успех: бот работает стабильно, генерирует песни, принимает оплату.

## Constraints/Assumptions
- Node.js 22, ESM, grammY 1.30, undici, ws
- Сервер: мини ПК 192.168.0.128 (Debian 13, systemd, НЕ Docker)
- SSH: `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'`
- SUNO API: self-hosted gcui-art/suno-api на localhost:3000
- AI: OpenRouter → deepseek/deepseek-v3-2 (сменили с Gemini 13.04)
- Robokassa: PAYWALL_ENABLED=false пока

## Key decisions
- Passkey refresh: CDP polling (refresh-passkey.js), вызывается on 422
- Store: in-memory (рестарт сервера теряет сессии)
- Генерация: 5 вопросов → AI текст (DeepSeek) → редактирование → SUNO custom_generate
- Bot Chromium: DISPLAY=:1001, CDP port 9222, с extension
- RDP Chromium: CDP port 9223, real user session
- SUNO endpoint: studio-api-prod.suno.com (URL пропатчен в .next/chunks/669.js)
- SUNO модель: chirp-fenix
- P1_ token: SUNO-specific JWT (HS256), ~1875-1956 chars, хранится в suno_passkey.txt
- Очередь генерации: 1 генерация за раз (src/queue.js)
- Доступ: 6-значные коды (src/access-codes.js), 20 кодов для бета-теста

## Critical Findings

### P1_ токен — как это работает
1. **CF Turnstile занимает 30-60s**: invisible challenge на /create — ждём 60s
2. **Захват**: навигация /create → 60s → fill form → click Create → Fetch.failRequest
3. **P1_ НЕ в сети**: только в React in-memory state браузера
4. **Token: null** → CF challenge не завершился (< 30s) или сессия Clerk устарела

### Cookie — как обновлять при смене аккаунта
`__client` — httpOnly, НЕ виден через `document.cookie`. Получать через:
```
Network.getAllCookies  (CDP)  — возвращает ВСЕ куки включая httpOnly
```
После захвата → сохранить в `suno_cookie.txt` → рестарт suno-api.

### SUNO transient errors
Иногда clips status=`error`, `audio_url: cdn1.suno.ai/None.mp3` — server-side failure.
Credits списываются. Повторная генерация обычно работает.

## State
- **Сейчас**: бот работает, новый SUNO аккаунт подключён ✅
- **Credits**: 2500/2500 (новый аккаунт, 0 потрачено)
- **Token**: P1_ свежий (захвачен 13.04, len=1888)
- **AI модель**: deepseek/deepseek-v3-2
- **Деплой**: commit 9e21024 на сервере

## Done (2026-04-13)
- Захвачен P1_ и cookie для нового SUNO аккаунта (2500 credits)
- Исправлен refresh-passkey.js: wait 60s, timeout 300s (d2451d1)
- Проактивный таймер: старт + каждые 25 мин (index.js)
- Доступ по 6-значному коду: 20 кодов, 1 per user (10709ef)
- Очередь генерации: серийная, с уведомлением о позиции (700eaef)
- AI промпт: поэт + ABAB/AABB рифмовка + 7-9 слогов + запрет штампов (0d8ed2c)
- Лимит слов: 200-220 (МИНИМУМ 180)
- AI модель: deepseek/deepseek-v3-2 (9e21024)
- Умные SUNO теги: Gemini/DeepSeek интерпретирует артистов, BPM, опечатки (5de276a)

## Now
- Бот работает, новый аккаунт 2500 credits

## Next
- Следить за логами при реальном использовании
- Если P1_ истечёт: `node /tmp/get_p1_hardreload.mjs`
- Если cookie устареет: `Network.getAllCookies` через CDP → suno_cookie.txt → restart suno-api
- Robokassa: включить PAYWALL_ENABLED=true когда готов прайсинг

## Open questions
- Как долго живёт P1_ server-side на новом аккаунте?
- Когда включать Robokassa?
- Стоит ли добавить авто-ретрай при SUNO transient error?

## Working set
- `src/suno/refresh-passkey.js` — CDP passkey refresh (60s wait, 300s timeout)
- `src/suno/client.js` — SUNO клиент + retry on 422
- `src/flow/generate.js` — orchestration
- `src/bots/telegram.js` — Telegram bot
- `src/ai/client.js` — DeepSeek, промпт поэта, ABAB рифмовка
- `src/queue.js` — серийная очередь генерации
- `src/access-codes.js` — 20 кодов доступа
- `src/index.js` — startup + passkey timer
- `/home/alexander/projects/suno_passkey.txt` — текущий P1_ токен
- `/home/alexander/projects/suno_cookie.txt` — Clerk cookie (включая __client)
- `/tmp/get_p1_hardreload.mjs` — ручной захват P1_ (60s wait)
- Bot Chromium CDP: localhost:9222 | RDP Chromium CDP: localhost:9223

## Ручное восстановление

### P1_ токен истёк:
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && node /tmp/get_p1_hardreload.mjs'
```

### Cookie устарела (смена аккаунта или 422 на session):
```bash
# На сервере запустить скрипт захвата __client через Network.getAllCookies
# Затем: sudo systemctl restart suno-api
```
