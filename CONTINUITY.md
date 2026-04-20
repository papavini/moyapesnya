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
- AI: OpenRouter → anthropic/claude-sonnet-4.6 (temperature 1, reasoning: effort high)
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
- **Critic:** anthropic/claude-sonnet-4.6 — cross-model, breaks echo chamber (OpenRouter dot notation)
- **Skip gate:** >= 12/15 total score (calibrate after 20-30 runs)
- **Phase 1 metrics module:** src/ai/metrics.js (pure JS, no new deps, node:test for tests)
- **Phase 1 MATTR threshold:** 0.60 (conservative gate floor, calibrate in Phase 4)
- **Phase 1 banale detection:** exact cluster lookup — 37 clusters deployed (requirement was ≥28)

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
- **AI модели (после echo-chamber фикса 16.04):**
  - **Analyzer (Phase 4):** `anthropic/claude-sonnet-4.6` (re-uses critic model; env override `AI_ANALYZER_MODEL`)
  - Генератор: `google/gemini-2.5-pro` (AI_MODEL в .env)
  - Критик: `anthropic/claude-sonnet-4.6` (config default) — cross-model ✓
  - Rewriter: `anthropic/claude-sonnet-4.6` (config default, hotfix 34f4f27)
- **Деплой:** commits 5ebf501 + d967c5d + 69032b1 + d5e8065 + **03a4d63 (rhyme tightening)** на сервере + .env AI_MODEL переключён в live
- **Cookie:** свежая (обновлена 14.04 08:51)
- **AI Poet Pipeline:** Phase 1 ✅, Phase 2 ✅, Phase 3 ✅, **Phase 4 ✅ (Subject Understanding)**. Все 4 LLM-раунда работают: U → G → C → R. Live tuning: metrics fast path отключён (5ebf501), sycophancy threshold 15% (d48e009), rewriter Sonnet 4.6 temp=1.0 (34f4f27).
- **Phase 4 COMPLETE (commits d967c5d + 69032b1):** src/ai/analyzer.js → understandSubject() возвращает портрет JSON (8 полей, валидация по shape). Pipeline: U → G → C → R, портрет передаётся всем downstream. Graceful degradation если portrait=null (30s timeout). Live тест после grounding fix подтвердил: «пёс»/«лабрадор»/«хвост» появляются в финальном тексте; logGroundingCheck даёт visibility на draft и rewritten этапах. Документация: `.planning/phases/04-subject-understanding/{04-RESEARCH,04-IMPLEMENTATION,04-VERIFICATION,04-SUMMARY}.md`.
- **Live результат Зевс v2 (после grounding fix):** «чёрный пёс» в строке 1 [Куплет 1], «лабрадор» в строке 6, рефрен «Зевс на Олимпе? Нет — Зевс у лужи!». 3 конкретные сцены (лужа / голова на коленях / шланг и брызги), wordplay поверх grounding, тон cheeky/playful. Узнаваемость подтверждена. **Остаточный долг (Phase 5 калибровка):** критик Sonnet 4.6 пропустил fake rhymes («всё/по-своему», «глаза/тебя», «всё/кино»); метрические шероховатости («по-своему» как costyль для рифмы), 2× «вот ___» как филлер; [Финал] всего 2 строки — не Phase 4 проблемы, это критик/rewriter не дожимает на rhyme_quality.

## Done (2026-04-16)
- **Generator prompt: chorus/finale tightening (commit 946d749, deployed):** в `SYSTEM_PROMPT` (`src/ai/client.js`) добавлены 4 новых блока (только additions, +60 строк): (1) BAD CHORUS примеры из прода — Зевс «дракон воды и тепла» / Герыч «метла светит»; (2) PROSE TEST — обязательное правило «прочти строку прозой, если бессмыслица — переписать», с конкретными FAIL/PASS примерами; (3) BAD FINALE — Герыч «это сказка, не иначе»; (4) MORE GOOD EXAMPLES — рабочие альтернативы припевов и финалов для Зевса/Герыча. JSON-формат и TAG RULES внизу промпта не тронуты. Деплоено на сервер.
- **Gate 3 soul floor (commit 948c1ff, deployed):** добавлены `DEAL_BREAKER_DIMS=['story_specificity','emotional_honesty']` и `DIM_FLOOR=2` в `src/ai/pipeline.js`. Fast path теперь требует ОБА условия: `total >= 12` И каждый soul dim ≥ 2. Раньше `[3,3,3,3,0]` на story давал total=12 и скипал rewriter — пустая по содержанию песня уходила пользователю. Новый лог `[pipeline] soul gate: <dims> below floor (2) — forcing rewrite`. Деплоено на сервер, бот active.
- **rewriter.js stale references почищены (commit cee2724):** заголовочный комментарий и fallback-строка в `src/ai/rewriter.js` ссылались на `google/gemini-2.5-flash`, хотя реально пайплайн использует `anthropic/claude-sonnet-4.6` с 34f4f27. Поведение не изменилось (config.js дефолт всегда побеждал) — только комментарии и fallback-строка синхронизированы. Деплой не нужен.
- **«Luchshii stih» reference зафиксирован (commit c06b8de):** новая коллекция `.planning/best-lyrics/` для эталонных живых результатов пайплайна. `zeus-v2.md` — первый POST-grounding-fix результат, помечен пользователем как «отлично, мне нравится». Внутри: заказ, портрет JSON, доставленный текст (5 секций), 5 причин почему лучший (узнаваемость / wordplay поверх grounding / 3 сцены из портрета / cheeky тон / эмоциональная динамика), pre/post сравнение vs Зевс v1, что осталось калибровать. README.md документирует формат `<имя-субъекта>-<версия>.md` и роль (reference baseline + A/B корпус для Phase 5 + демо). Запушено в origin/main.
- **Critic rhyme_quality ужесточён (commit 03a4d63):** переписана DIMENSION 3 в `CRITIC_SYSTEM_PROMPT`. Добавлено:
  - MANDATORY процедура: критик ОБЯЗАН перечислить каждую рифмованную пару перед оценкой
  - 4-уровневая классификация: TRUE / APPROXIMATE / FAKE / BANALE с конкретными русскими примерами
  - 8 fake-rhyme примеров из реальных провалов (всё/по-своему, глаза/тебя, всё/кино, любовь/навсегда, душа/дорога и др.)
  - Жёсткая шкала: 1 fake = score ≤ 1; 2+ fake = 0
  - APPROXIMATE рифмы (готово/корона, кросс/слёз) явно помечены как acceptable — чтобы не задушить попсовые off-rhymes
  - rewrite_instructions для fake обязан цитировать пару в формате «word1 / word2»
  - Деплоено на сервер, бот рестартован.
- **Phase 4 COMPLETE — Subject Understanding (U→G→C→R):**
  - `d967c5d` feat(ai): add Subject Understanding (U) step before G→C→R pipeline. New `src/ai/analyzer.js` (211 lines) — `understandSubject()` returns 8-field portrait JSON via Sonnet 4.6, 2-attempt retry, 30s budget, returns null on exhaustion (graceful degradation). Pipeline rewired: Step U executes first; portrait threaded as optional 3rd/4th param into `generateLyrics()`/`critiqueDraft()`/`rewriteDraft()`. All signatures backward-compatible via `portrait = null` default.
  - **Live test failure surfaced grounding gap:** Зевс song delivered with rich Zeus/громовержец wordplay but ZERO occurrences of «пёс»/«собака»/«лабрадор»/«лапа»/«хвост» — listener could not identify subject category. Root cause: analyzer's `phrases_to_AVOID` contained «верный пёс» → generator over-generalized to "don't say пёс anywhere".
  - `69032b1` fix(ai): ground the listener — force category nouns into lyrics. Added `subject_category_nouns` field (1-4 bare nouns). 3-layer prompt enforcement: generator MUST-MENTION block + critic deterministic GROUNDING VERDICT (computed in JS) + rewriter explicit "это НЕ нарушение KEEP" insertion instruction. Defensive filter in `parsePortrait()` strips bare single-word entries from `phrases_to_AVOID`. Pipeline emits `[pipeline] grounding ok/MISS (draft|rewritten)` log lines.
  - **Live re-run confirmed fix:** delivered lyrics now contain «пёс»/«лабрадор»/«хвост»; `grounding ok (rewritten)` log line confirmed.
  - **Documentation:** `.planning/phases/04-subject-understanding/` — 04-RESEARCH.md, 04-IMPLEMENTATION.md, 04-VERIFICATION.md (14/14 truths verified), 04-SUMMARY.md. ROADMAP.md updated (Phase 4 = Subject Understanding; original Phase 4 → Phase 5: A/B Validation). STATE.md → current_phase=5, completed_phases=4.
- **Live tuning после Phase 3 deploy** (наблюдение за реальными заказами):
  - 34f4f27: rewriter переключён Gemini Flash → Sonnet 4.6 (Flash копировал оригинал, 1.3% новизны); temp=1.0; timeout 90s; критик логирует все 5 dim'ов + rewrite_instructions для weak
  - d48e009: sycophancy threshold 20% → 15% (геом. потолок при 2/5 KEEP ≈ 30%, Sonnet давал 19.7% — отвергался впритык)
  - 5ebf501: metrics fast path ОТКЛЮЧЁН (37 кластеров не ловят фразовые клише «лучший на свете», AAAA-монорим, fake rhymes)
  - **Echo chamber фикс**: AI_MODEL .env Sonnet 4.6 → google/gemini-2.5-pro. Генератор и критик теперь разные семейства моделей.
- **Phase 3 COMPLETE:** src/ai/rewriter.js (Gemini 2.5 Flash, thinking mode, KEEP guard), src/ai/pipeline.js (5-gate orchestrator, timeouts, sycophancy guard), telegram.js wired to runPipeline(). 03-VERIFICATION: 15/15 auto checks GREEN. Commits: 9b06b08, 224e8e0, f8c29a8, 0ff40a2.
- AI Poet Pipeline: исследование завершено (research/SUMMARY.md)
- AI Poet Pipeline: требования зафиксированы (REQUIREMENTS.md, 13 v1 req)
- AI Poet Pipeline: roadmap создан (.planning/ROADMAP.md, 4 фазы, 13/13 coverage)
- AI Poet Pipeline: STATE.md инициализирован
- Phase 1 research: .planning/phases/01-programmatic-metrics-gate/01-RESEARCH.md создан
- **Plan 01-01 DONE:** src/ai/metrics.js skeleton + src/ai/metrics.test.js (9 cases, 4 describe blocks, RED state confirmed, commit 2aea5c7)
- **Plan 01-02 DONE:** src/ai/metrics.js full implementation — 37 clusters, syllable checker, MATTR-approx, scoreDraft gate. All 9 tests GREEN (commit 607c612)
- **Plan 01-03 DONE:** scoreDraft wired into generateLyrics() in src/ai/client.js. npm test + npm run check added. VERIFICATION: 4/4 SC passed (commit 90c1715)
- **Phase 2 DONE:** Critic Integration — src/ai/critic.js (305 lines), src/ai/critic.test.js (6 tests GREEN), config.ai.criticModel. Model: anthropic/claude-sonnet-4.6 (dot notation). judgeSpecificity + critiqueDraft, 5-dim rubric (0-3 each), skip gate >=12/15. Manual inspection: rewrite_instructions cite specific lines ✅, variance=0 across 3 runs ✅ (commit 58c7505)

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
- **Phase 4 закрыт + critic rhyme_quality ужесточён (03a4d63) + «luchshii stih» reference зафиксирован (c06b8de).** Pipeline U→G→C→R работает в проде с новой DIMENSION 3. Зевс v2 закреплён как первый эталон в `.planning/best-lyrics/`. Готов к следующему живому заказу для проверки эффекта tightening.

## Next
- Следующий живой заказ → смотреть `[critic] weak rhyme_quality (...)` в логах: критик должен теперь явно перечислять fake пары и снижать оценку
- Если фейк-рифмы всё ещё проходят → дополнить `CRITIC_SYSTEM_PROMPT` ещё примерами или добавить программный детектор в `metrics.js` (last-2-chars heuristic)
- Если CLEAN_DRAFT тест начнёт падать на total >= 12 — подправить fixture (заменить approximate-pairs на true rhymes)
- Мониторить `[pipeline] grounding ok (draft)` rate за следующие 10-20 живых заказов (target >= 70%)
- Phase 5 (`/gsd-plan-phase 5`): собрать 10-15 реальных тест-кейсов в `.planning/testcases/`, A/B blind listening, go/no-go
- Robokassa: включить PAYWALL_ENABLED=true когда готов прайсинг

## Open questions
- Когда включать Robokassa?
- Стоит ли добавить авто-ретрай при SUNO transient error (None.mp3)?
- Нужен ли вообще P1_ refresh или можно убрать совсем?
- Exact OpenRouter param for Gemini 2.5 Flash thinking mode (`include_reasoning: true`?) — verify before Phase 3
- ~~Exact OpenRouter ID for Claude Sonnet 4.6~~ — resolved: `anthropic/claude-sonnet-4.6` (dot notation)
- ~~METRICS-01 ">=28 clusters"~~ — resolved: 37 clusters deployed

## Working set
- `.planning/ROADMAP.md` — **5-phase roadmap** (Phase 4 = Subject Understanding inserted; Phase 5 = A/B Validation)
- `.planning/STATE.md` — pipeline project state (current_phase=5, completed_phases=4)
- `.planning/REQUIREMENTS.md` — 13 v1 requirements (METRICS, PIPELINE, MODELS, VALID) + 4 added (UNDERSTAND-01..04)
- `.planning/phases/01-programmatic-metrics-gate/` — Phase 1 artifacts (research, plans, summaries, VERIFICATION.md)
- `.planning/phases/02-critic-integration/` — Phase 2 artifacts
- `.planning/phases/03-rewriter-and-full-pipeline/` — Phase 3 artifacts
- `.planning/phases/04-subject-understanding/` — Phase 4 artifacts: 04-RESEARCH.md, 04-IMPLEMENTATION.md, 04-VERIFICATION.md, 04-SUMMARY.md
- `src/ai/analyzer.js` — **NEW (Phase 4):** understandSubject() → 8-field portrait JSON, Sonnet 4.6, 30s timeout, defensive filter
- `src/ai/pipeline.js` — runPipeline() U→G→C→R, 5 gates + Step U + logGroundingCheck
- `src/ai/metrics.js` — metrics gate module (scoreDraft, 37 banale clusters, syllable+MATTR)
- `src/ai/metrics.test.js` — 9 tests, node:test, GREEN
- `src/ai/critic.js` — critiqueDraft(lyrics, metrics, portrait=null), 5-dim rubric, deterministic GROUNDING CHECK
- `src/ai/critic.test.js` — 6 integration tests, GREEN (requires OPENROUTER_API_KEY)
- `src/ai/client.js` — generateLyrics({...,portrait=null}) → {lyrics, tags, title, metrics}; formatPortraitBlock with MUST-MENTION
- `src/ai/rewriter.js` — rewriteDraft(lyrics, critique, portrait=null), KEEP guard, ОБЯЗАТЕЛЬНЫЕ СЛОВА block
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
