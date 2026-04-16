# Continuity Ledger

## Goal
Telegram-бот «Подари Песню!» (@podaripesniu_bot) — продажа персональных песен через SUNO.
Успех: бот работает стабильно, генерирует песни, принимает оплату.

**Текущий подпроект:** AI Poet Pipeline — multi-step G→C→R pipeline для повышения качества текстов.

## Constraints/Assumptions
- Node.js 22, ESM, grammY 1.30, undici, ws
- Сервер: мини ПК 192.168.0.128 (Debian 13, systemd, НЕ Docker)
- SSH: `wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'`
- SUNO API: self-hosted gcui-art/suno-api на localhost:3000
- AI: OpenRouter → anthropic/claude-sonnet-4-6 (temperature 1, reasoning: effort high)
- Robokassa: PAYWALL_ENABLED=false пока
- Pipeline latency budget: max 150s total

## Key decisions
- Passkey refresh: CDP polling (refresh-passkey.js), вызывается on 422 с реальными данными пользователя
- Cookie refresh: CDP Network.getAllCookies (refresh-cookie.js), вызывается on 500 "session id"
- Проактивные таймеры P1_ и cookie — УБРАНЫ полностью (systemd disabled 14.04)
- Refresh только on-demand: ensureTokenAlive (до генерации) + handleSunoError (во время)
- Store: in-memory (рестарт сервера теряет сессии)
- Генерация: 5 вопросов → AI текст (Gemini 2.5 Pro) → редактирование → SUNO custom_generate
- Bot Chromium: DISPLAY=:1001, CDP port 9222, с extension
- RDP Chromium: CDP port 9223, real user session
- SUNO endpoint: studio-api-prod.suno.com (URL пропатчен в .next/chunks/669.js)
- SUNO модель: chirp-fenix
- P1_ token: JWT HS256, ~1870-1960 chars, хранится в suno_passkey.txt
- Очередь генерации: 1 генерация за раз (src/queue.js)
- Доступ: 6-значные коды (src/access-codes.js), 20 кодов для бета-теста
- **AI Poet Pipeline build order:** Metrics Gate → Critic → Rewriter+Pipeline → A/B Validation
- **Generator/Rewriter:** google/gemini-2.5-flash + thinking mode ON (`include_reasoning: true` — verify)
- **Critic:** anthropic/claude-sonnet-4-6 — cross-model, breaks echo chamber
- **Skip gate:** >= 12/15 total score (calibrate after 20-30 runs)
- **Phase 1 metrics module:** src/ai/metrics.js (pure JS, no new deps, node:test for tests)
- **Phase 1 MATTR threshold:** 0.60 (conservative gate floor, calibrate in Phase 4)
- **Phase 1 banale detection:** exact cluster lookup (18 clusters → expand to 28 before deploy)

## Critical Findings

### P1_ токен — реальная роль
**ВАЖНО (открытие 2026-04-13):** P1_ токен НЕ является основной аутентификацией.
Тест: записали "P1_invalid_expired_token_for_testing" → suno-api принял запрос и песня сгенерировалась.
**Настоящая аутентификация — это cookie (Clerk сессия `__client`).**
P1_ токен suno-api проверяет мягко или имеет внутренний механизм обновления.

### P1_ токен — как захватывать при необходимости
1. **CF Turnstile занимает 30-60s**: invisible challenge на /create — ждём 60s
2. **Захват**: навигация /create → 60s → fill form → click Create → Fetch.failRequest
3. **P1_ НЕ в сети**: только в React in-memory state браузера
4. **Token: null** → CF challenge не завершился или сессия Clerk устарела
5. **При 422**: передаём реальные данные пользователя (lyrics/tags/title) — не dummy

### Cookie — главная аутентификация
`__client` — httpOnly Clerk cookie, **НЕ виден** через `document.cookie`. Получать через:
```
Network.getAllCookies (CDP) — возвращает ВСЕ куки включая httpOnly
```
Записывать ТОЛЬКО нужные куки (5 штук), не все 45:
- `__client`, `__client_uat`, `__client_uat_Jnxw-muT`, `__client_Jnxw-muT`, `suno_device_id`
- Все 45 → "Request Header Fields Too Large" от SUNO

После захвата → сохранить в `suno_cookie.txt` → `sudo systemctl restart suno-api`.
Авто-refresh: `refresh-cookie.js` — триггерится при HTTP 500 "session id".

### SUNO transient errors
Иногда clips status=`error`, `audio_url: cdn1.suno.ai/None.mp3` — server-side failure.
Credits списываются. Повторная генерация обычно работает.

## State
- **Бот:** работает ✅, cookie свежая (обновлена вручную 14.04), suno-api авторизован
- **Credits:** 2040/2500
- **AI модель:** google/gemini-2.5-pro + reasoning:high via OpenRouter
- **Деплой:** commit 422797d на сервере
- **Cookie:** свежая (обновлена 14.04 08:51)
- **AI Poet Pipeline:** Phase 1 research complete, ready for planning

## Done (2026-04-16)
- AI Poet Pipeline: исследование завершено (research/SUMMARY.md)
- AI Poet Pipeline: требования зафиксированы (REQUIREMENTS.md, 13 v1 req)
- AI Poet Pipeline: roadmap создан (.planning/ROADMAP.md, 4 фазы, 13/13 coverage)
- AI Poet Pipeline: STATE.md инициализирован
- Phase 1 research: .planning/phases/01-programmatic-metrics-gate/01-RESEARCH.md создан

## Done (2026-04-14)
- Анализ логов: cookie-refresh.sh (таймер) использовал порт 9222 (бот) вместо 9223 (RDP) → каждые 25 мин записывал плохую cookie и рестартовал suno-api прямо во время polling
- `refresh-cookies.sh` переписан: теперь делегирует в Node.js `refresh-cookie.js` (порт 9223, 5 essential куки)
- `do-cookie-refresh.mjs` создан как wrapper для bash-скрипта
- `passkey-refresh.timer` и `cookie-refresh.timer` отключены (`systemctl disable --now`)
- `ensureTokenAlive`: при 3x 500 **с session error в теле** делает cookie refresh (не на любой 500!)
- `generateCustom`/`generateByDescription`: вложенный try-catch — 3 попытки, 2 fix-цикла (500→cookie→422→passkey каскад)
- `telegram.js`: добавлены логи при доставке (`[telegram] доставляем N клипов`) и ошибке
- Тест авто-восстановления (14.04): сломали cookie → 3x 500 → session error → refreshCookie() → 2 клипа доставлены ✅
- Деплой: commit f560d28, credits 2020/2500

## Done (2026-04-13)
- Захвачен P1_ и cookie для нового SUNO аккаунта (2500 credits)
- Исправлен refresh-passkey.js: wait 60s, timeout 300s (d2451d1)
- Доступ по 6-значному коду: 20 кодов, 1 per user (10709ef)
- Очередь генерации: серийная, с уведомлением о позиции (700eaef)
- AI промпт: поэт + ABAB/AABB рифмовка + запрет штампов + грамматика > рифма
- Примеры плохих строк в промпте + самопроверка + 6-10 слогов
- Простой разговорный язык: запрет книжных слов (лучезарный, преданность и т.д.)
- AI модель: anthropic/claude-sonnet-4.6 (финальная)
- Исправлен ID модели: deepseek/deepseek-v3-2 → deepseek/deepseek-v3.2 → claude-sonnet-4.6
- Убран response_format (DeepSeek не поддерживает как OpenAI)
- Ошибка AI: показывает ошибку, НЕ падает на description-генерацию (40251bb)
- Cookie авто-refresh: src/suno/refresh-cookie.js (5d42894)
- Фикс cookie: только 5 нужных кук вместо 45 (c1adf85)
- Лог ошибки в generate.js catch блоке (c1adf85)
- Убран проактивный таймер P1_ (мусорные песни) (3b997d2)
- P1_ refresh использует реальные данные пользователя (3b997d2)
- Открытие: P1_ не критичен, cookie — главная аутентификация (тест 13.04)

## Now
- AI Poet Pipeline Phase 1: planning (research done, planner consumes 01-RESEARCH.md)

## Next
- `/gsd-plan-phase 1` — создать PLAN.md для Phase 1
- Следить за логами бота при реальном использовании
- Robokassa: включить PAYWALL_ENABLED=true когда готов прайсинг

## Open questions
- Когда включать Robokassa?
- Стоит ли добавить авто-ретрай при SUNO transient error (None.mp3)?
- Нужен ли вообще P1_ refresh или можно убрать совсем?
- Exact OpenRouter param for Gemini 2.5 Flash thinking mode (`include_reasoning: true`?) — verify before Phase 3
- Exact OpenRouter ID for Claude Sonnet 4.6 — verify before Phase 2
- METRICS-01 ">=28 clusters": 18 cluster groups или 28 pairs? Уточнить перед Phase 1 plan

## Working set
- `.planning/ROADMAP.md` — 4-phase roadmap, AI Poet Pipeline
- `.planning/STATE.md` — pipeline project state
- `.planning/REQUIREMENTS.md` — 13 v1 requirements (METRICS, PIPELINE, MODELS, VALID)
- `.planning/phases/01-programmatic-metrics-gate/01-RESEARCH.md` — Phase 1 research
- `src/ai/client.js` — target file for all pipeline changes
- `src/suno/refresh-cookie.js` — CDP → essential cookies → suno_cookie.txt → restart suno-api
- `src/suno/refresh-passkey.js` — CDP passkey refresh (60s wait, принимает fills от пользователя)
- `src/suno/client.js` — SUNO клиент: handleSunoError (500→cookie, 422→token)
- `src/flow/generate.js` — orchestration
- `src/bots/telegram.js` — Telegram bot
- `src/queue.js` — серийная очередь генерации
- `src/access-codes.js` — 20 кодов доступа
- `/home/alexander/projects/suno_passkey.txt` — P1_ токен (не критичен)
- `/home/alexander/projects/suno_cookie.txt` — Clerk cookie (5 essential cookies)
- Bot Chromium CDP: localhost:9222 | RDP Chromium CDP: localhost:9223

## Ручное восстановление

### Cookie устарела (главная проблема):
Авто-срабатывает при 500 "session id". Если не сработало:
```bash
# На сервере запустить вручную:
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'node -e "
import(\"/home/alexander/projects/moyapesnya/src/suno/refresh-cookie.js\")
  .then(m => m.refreshCookie())
  .then(() => console.log(\"OK\"))
  .catch(e => console.error(e.message));
"'
```

### P1_ токен (если нужен ручной захват):
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && node /tmp/get_p1_hardreload.mjs'
```
