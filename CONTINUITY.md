# Continuity Ledger

## Goal
Telegram-бот «Подари Песню!» (@podaripesniu_bot) — продажа персональных песен через SUNO.
Успех: бот работает стабильно, генерирует песни, принимает оплату.

## Constraints/Assumptions
- Node.js 22, ESM, grammY 1.30, undici, ws
- Сервер: мини ПК 192.168.0.128 (Debian 13, systemd, НЕ Docker)
- SSH: `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'`
- SUNO API: self-hosted gcui-art/suno-api на localhost:3000
- AI: OpenRouter → google/gemini-3.1-flash-lite-preview
- Robokassa: PAYWALL_ENABLED=false пока

## Key decisions
- Passkey refresh: CDP polling (refresh-passkey.js), вызывается on 422
- Store: in-memory (рестарт сервера теряет сессии)
- Генерация: 5 вопросов → AI текст (Gemini) → редактирование → SUNO custom_generate
- Bot Chromium: DISPLAY=:1001, CDP port 9222, с extension
- RDP Chromium: CDP port 9223, real user session (sonarliktor)
- SUNO endpoint: studio-api-prod.suno.com (URL пропатчен в .next/chunks/669.js)
- SUNO модель: chirp-fenix
- P1_ token: SUNO-specific JWT (HS256), ~1875-1956 chars, хранится в suno_passkey.txt

## Critical Findings (Сеансы 2-3, 2026-04-13)

### P1_ токен — как это работает
1. **P1_ НЕ в сети**: token не появляется ни в одном HTTP-ответе ни от одного домена
2. **P1_ в React state**: хранится только в памяти фронтенда, недоступен через localStorage/globals/fiber scan
3. **Источник P1_**: CF Turnstile invisible challenge на странице /create → автоматически вызывается SUNO при загрузке страницы
4. **CF Turnstile занимает 30-60s**: невидимая проверка работает в фоне молча — нужно ждать полные 60s
5. **Захват P1_**: ждём 60s → заполняем форму → кликаем Create → generate POST body содержит `{"token":"P1_..."}`
6. **Fetch.failRequest**: перехватываем generate → извлекаем P1_ → отменяем запрос (кредиты НЕ тратятся)
7. **Token: null** происходит когда CF challenge ещё не завершился (< 30s) или P1_ expired и CF тоже не дал новый
8. **1.xxx Clerk token**: это НЕ P1_, а CF Turnstile для auth.suno.com (Clerk auth) — не подходит для генерации
9. **Studio-api URL**: пропатчен: `studio-api.prod.suno.com` → `studio-api-prod.suno.com`
10. **auth.suno.com**: Clerk auth endpoint, captcha_token (1.xxx) — НЕ источник P1_

### Ключевой баг и фикс (commit d2451d1)
- **Баг**: wait 20s после навигации на /create → CF Turnstile ещё не завершился → P1_ = null → capture fails
- **Фикс**: wait **60s** → CF Turnstile всегда успевает → P1_ в React state → fill form → click Create → P1_ в body

### SUNO transient errors
- Иногда SUNO возвращает clips со status=`error` и `audio_url: cdn1.suno.ai/None.mp3`
- Это server-side rendering failure на стороне SUNO (не наш баг)
- Credits всё равно списываются
- Решение: повторная генерация обычно проходит успешно

## State
- **Сейчас**: бот работает, генерация подтверждена пользователем ✅
- **Token**: валидный P1_, refresh каждые 25 мин + при старте
- **Credits**: ~625 (из 2500/мес)
- **Деплой**: commit d2451d1 на сервере

## Done (2026-04-13, полная сессия)
- Захвачен P1_ токен вручную (get_token_v2.mjs) после истечения
- Исправлен refresh-passkey.js: wait 60s (вместо 20s), timeout 300s (d2451d1)
- Добавлен проактивный таймер: старт через 10s + каждые 25 мин (index.js)
- Startup timer подтверждён: OK (passkey len=1951, passkey-server 200)
- Полный флоу подтверждён пользователем: бот работает ✅
- Создан /tmp/get_p1_hardreload.mjs — надёжный ручной захват (60s wait)

## Now
- Бот работает, токен свежий
- Следующее плановое обновление токена: каждые 25 мин автоматически

## Next
- Следить за логами при реальном использовании
- Robokassa: включить PAYWALL_ENABLED=true когда будет готов прайсинг
- Если SUNO даёт ошибки подряд (transient) — нужна автоматическая одна повторная попытка

## Open questions
- Как долго живёт P1_ server-side? (наблюдение: ~30 мин в React state, возможно дольше server-side)
- Когда включать Robokassa (PAYWALL_ENABLED=true)?
- Стоит ли добавить авто-ретрай при SUNO error (transient)?

## Working set
- `src/suno/refresh-passkey.js` — CDP passkey refresh (60s wait, 300s timeout, d2451d1) ← ключевой файл
- `src/suno/client.js` — SUNO клиент + retry on 422
- `src/flow/generate.js` — orchestration: generate → poll → return result
- `src/bots/telegram.js` — Telegram bot handler
- `src/index.js` — startup + passkey timer (10s + 25min)
- `/home/alexander/projects/suno_passkey.txt` — текущий ВАЛИДНЫЙ P1_ токен
- `/home/alexander/projects/suno-api/.next/server/chunks/669.js` — пропатчен studio-api URL
- `/tmp/get_p1_hardreload.mjs` — ручной захват P1_ (60s wait, Fetch.failRequest)
- `/tmp/get_token_v2.mjs` — старый ручной захват (8s wait — работает только если P1_ уже в React state)
- Bot Chromium CDP: localhost:9222 | RDP Chromium CDP: localhost:9223

## Ручное восстановление (если refresh упал)
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && node /tmp/get_p1_hardreload.mjs'
```
Ждёт 60s → заполняет форму → перехватывает P1_ → сохраняет → рестартует suno-api.
