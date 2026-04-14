# История изменений и текущий статус

## Текущий статус (апрель 2026)

| Компонент | Статус |
|---|---|
| Telegram бот — основной флоу | ✅ Работает |
| Доступ по коду (бета-тест) | ✅ Активен (20 кодов) |
| AI генерация текстов (Gemini 2.5 Pro) | ✅ Работает |
| SUNO генерация треков | ✅ Работает |
| Cookie авто-refresh (CDP, on-demand) | ✅ Работает |
| Passkey авто-refresh (CDP, on-demand) | ✅ Работает (on 422) |
| Очередь генерации | ✅ Работает (1 за раз) |
| Robokassa paywall | ⏸ Выключена (PAYWALL_ENABLED=false) |
| VK-бот | ⏸ Отключён (токен не задан) |
| Голосовые сообщения (STT) | 🔲 Не реализовано |
| Редактирование текста (AI) | ✅ Работает |

## Ключевые технические решения

### Docker → systemd
Docker не используется: `$` в cookies ломает env_file синтаксис.
Все сервисы запущены как systemd units напрямую.

### Cookie из файла — главная аутентификация
`suno-api` читает cookie из `~/projects/suno_cookie.txt` при старте (через ExecStart).
**Важно:** записывать только 5 нужных кук, не все (~45) — иначе "Request Header Fields Too Large":
- `__client`, `__client_uat`, `__client_uat_Jnxw-muT`, `__client_Jnxw-muT`, `suno_device_id`

`__client` — httpOnly Clerk cookie, недоступна через `document.cookie`.
Единственный способ получить: `Network.getAllCookies` (CDP).

### Авто-refresh cookie (src/suno/refresh-cookie.js)
При HTTP 500 "session id" от suno-api:
1. CDP подключается к RDP Chromium (порт 9223)
2. `Network.getAllCookies` → фильтрует suno.com essential cookies
3. Записывает в `suno_cookie.txt`
4. `sudo systemctl restart suno-api`
5. Ждёт пока `/api/get_limit` ответит OK
6. Повторяет исходный запрос

### P1_ токен — менее критичен, чем казалось
JWT HS256, ~1870 chars. Источник: CF Turnstile invisible challenge на `/create` (30-60 сек).

**Открытие (тест 13.04.2026):** P1_ токен не является строгой аутентификацией.
Запрос с `"token": "P1_invalid_expired_token_for_testing"` был принят SUNO и песня сгенерировалась.
Настоящая аутентификация — это Clerk cookie (`__client`).

Захват при необходимости (CDP):
- навигация /create → ждём 60s → fill form (реальными данными пользователя) → click Create → Fetch.failRequest перехватывает generate body → P1_ извлечён
- Кредиты не тратятся (Fetch.failRequest блокирует запрос до сервера)

### Авто-refresh P1_ (src/suno/refresh-passkey.js)
При HTTP 422 от suno-api:
- Передаются реальные данные пользователя (lyrics/tags/title) — не dummy
- Это исключает мусорные песни в SUNO аккаунте
- Таймер каждые 25 мин **убран** (создавал мусор)

### AI — промпт поэта (src/ai/client.js)
Модель: `google/gemini-2.5-pro` via OpenRouter, режим `reasoning: { effort: 'high' }`, temperature 0.9.

Ключевые правила промпта:
- **Грамматика > Рифма**: если рифма ломает грамматику — откажись от рифмы
- Примеры плохих строк прямо в промпте (из реальных ошибок)
- Самопроверка: "перечитай каждую строку вслух — так говорят живые люди?"
- Запрет книжных слов: лучезарный, преданность, ласка чуду, восторг, лоно и т.д.
- Разговорный язык: "как говоришь с другом"
- Слоги: 6-10 (не 7-9 — в русском языке нужна гибкость)
- ABAB в куплетах, AABB в припеве
- Запрет штампов: звёзды/слёзы, мечты/цветы, любовь/вновь и т.д.
- Конкретные детали вместо абстракций
- МИНИМУМ 180 слов, цель 200-220

### SUNO endpoint
- Используем `/api/generate/v2-web/` (не `/api/generate/v2/`)
- Модель: `chirp-fenix` (v5.5)
- suno-api патчит URL в `.next/server/chunks/669.js` на `studio-api-prod.suno.com`

### ensureTokenAlive + handleSunoError (src/suno/client.js)

**До генерации — `ensureTokenAlive`:**
1. Пробует `/api/get_limit` трижды (с интервалом 3 сек)
2. Если OK → продолжает
3. Если 3x 500 — читает тело ответа:
   - Тело содержит `session` / `SUNO_COOKIE` → это session error → обновляет cookie, проверяет снова
   - Другой 500 (глюк, перегрузка) → **не трогает куку**, продолжает (`return true`) — handleSunoError в generateCustom разберётся
4. Если после refresh всё ещё session error → возвращает false → "студия недоступна"

**Во время генерации — `handleSunoError` в generateCustom:**
```
Попытка 1: POST /api/custom_generate
  └── 500 "session id" → refreshCookie()
  └── 422 "Token"      → refreshPasskeyToken(fills)
Попытка 2 (после 1-го fix):
  └── если снова ошибка → снова handleSunoError
Попытка 3 (финальная)
```
Каскад 500→cookie→422→passkey обрабатывается полностью. Рабочий токен никогда не перезаписывается зря.

### Store in-memory
Сессии хранятся в RAM. При рестарте сервиса — теряются.
Для продакшна нужен Redis или SQLite.

### Кэш video file_id
Приветственное видео загружается один раз, потом Telegram file_id кэшируется
в `src/assets/.video_file_id` — повторные отправки без загрузки файла.

## Известные проблемы

1. `store.js` — in-memory: рестарт сервера теряет все незавершённые сессии
2. Голосовые сообщения — заглушка, STT не реализован
3. SUNO transient errors: иногда clips со status=`error`, `audio_url: cdn1.suno.ai/None.mp3` — credits списываются, повтор обычно работает
4. P1_ refresh: если Clerk сессия в Chromium устарела, `token: null` — нужен ручной вход в браузере

## Деплой

```bash
# На локальной машине:
git add -A && git commit -m "msg" && git push origin main

# На сервере:
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-bot'
```

## История ключевых изменений

### 2026-04-14 — Отключены все proactive таймеры (passkey-refresh, cookie-refresh)
**Проблема:** `passkey-refresh.timer` (каждые 25 мин) и `cookie-refresh.timer` рестартовали suno-api произвольно — прямо во время polling'а waitForClips. Пользователи получали 500-ошибки.
**Причина была скрыта:** systemd-таймеры продолжали работать даже после того как setTimeout-код был убран из index.js.
**Фикс:** `sudo systemctl disable --now passkey-refresh.timer cookie-refresh.timer`
Вся логика refresh теперь on-demand: проверка перед генерацией (ensureTokenAlive) + обработка ошибок во время генерации (handleSunoError).

### 2026-04-14 — cookie-refresh.sh починен (порт 9222 → 9223)
**Проблема:** скрипт таймера использовал бот-хромиум (CDP :9222) вместо RDP-хромиума с реальной сессией (CDP :9223). Мог записывать неправильные или слишком большие cookie.
**Фикс:** скрипт переписан — делегирует в `node /home/alexander/projects/do-cookie-refresh.mjs`, который вызывает `src/suno/refresh-cookie.js` (правильный порт, 5 essential кук).

### 2026-04-14 — ensureTokenAlive: умный refresh по телу ответа (commit f560d28)
**Проблема 1:** ensureTokenAlive видел 3x 500 и молча возвращал true → generateCustom получал то же 500 и делал cookie refresh — двойная работа.
**Проблема 2:** ensureTokenAlive делал refresh на ЛЮБОЙ 500 → перезаписывал рабочий токен при временных глюках suno-api.
**Фикс:** читает тело ответа. Refresh только если тело содержит `session` / `SUNO_COOKIE`. Другие 500 — не трогает куку, пропускает в generateCustom.

### 2026-04-14 — generateCustom: каскадная обработка ошибок (commit 422797d)
**Проблема:** retry после cookie refresh не имел своего catch. Если retry получал 422 — ошибка улетала в generate.js, пользователь видел "Не получилось".
**Фикс:** вложенный try-catch, до 3 попыток с 2 циклами fix: 500→cookie→retry→422→passkey→retry→success.

### 2026-04-14 — Логи при доставке песен (commit 4b71685)
Добавлены `console.log` при отправке клипов пользователю и при ошибке генерации. Теперь в journalctl видно: `[telegram] доставляем N клипов пользователю ID` и `[telegram] клип отправлен: XXXXXXXX`.

### 2026-04-14 — AI модель: google/gemini-2.5-pro + reasoning:high
Лучшее качество русских стихов из всех протестированных. Путь: Gemini Flash → Claude Sonnet → DeepSeek → Claude Opus → Claude Sonnet 4.6 → **Gemini 2.5 Pro**.
Режим thinking (`reasoning: { effort: 'high' }`), temperature 0.9, max_tokens 16000.

### 2026-04-13 — Убран проактивный таймер P1_ (commit 3b997d2)
**Проблема:** каждые 25 мин создавалась мусорная песня ("Another Year Around the Sun") в SUNO аккаунте.
**Фикс:** таймер убран. P1_ обновляется только on-demand при 422.
**Бонус:** при обновлении теперь используются реальные данные пользователя (lyrics/tags/title), не dummy.

### 2026-04-13 — Открытие: P1_ не критичен, cookie — главное
Тест с невалидным P1_ токеном показал: SUNO принимает запрос и генерирует песню.
Настоящая аутентификация — Clerk cookie `__client`. P1_ suno-api проверяет мягко.

### 2026-04-13 — Cookie авто-refresh (commit c1adf85, 5d42894)
**Проблема:** cookie протухала → suno-api возвращал 500 "session id" → генерация падала.
**Фикс 1:** src/suno/refresh-cookie.js — CDP → Network.getAllCookies → файл → restart suno-api.
**Фикс 2:** фильтровать только 5 essential cookies (не все 45) — иначе "Request Header Fields Too Large".
**Интеграция:** handleSunoError в client.js — при 500 авто-триггерит refreshCookie().

### 2026-04-13 — AI модель: anthropic/claude-sonnet-4.6
Путь: Gemini → deepseek/deepseek-v3-2 (неверный ID) → deepseek/deepseek-v3.2 → claude-sonnet-4.6.
Claude нативно понимает русский, не ломает грамматику, хорошо пишет стихи.

### 2026-04-13 — Промпт: грамматика > рифма (commit 96bab65)
**Проблема:** модель жертвовала грамматикой ради рифмы ("И есть много на своей еде").
**Фикс:** явное правило "грамматика важнее рифмы", примеры плохих строк, самопроверка, слоги 6-10.

### 2026-04-13 — Простой разговорный язык (commit a81010b)
Запрет книжных/пафосных слов: лучезарный, преданность, ласка чуду, основы и т.д.
Установка: "как говоришь с другом, а не читаешь книгу".

### 2026-04-13 — Ошибка AI: показывать ошибку, не генерировать без текста (commit 40251bb)
**Проблема:** при сбое AI бот молча генерировал песню без текста (description mode fallback).
**Фикс:** показываем "⚠️ Не удалось сочинить текст. Попробуйте ещё раз — /start", сессия сбрасывается.

### 2026-04-13 — Убран response_format (commit 40251bb)
`response_format: { type: 'json_object' }` убран — DeepSeek не поддерживает как OpenAI.
JSON парсится через regex-fallback (уже был в коде).

### 2026-04-13 — Passkey: фикс CF Turnstile (commit d2451d1)
**Проблема:** P1_ = null при каждом авто-refresh.
**Причина:** CF Turnstile занимает 30-60 сек, код ждал 20 сек.
**Фикс:** ожидание до 60 сек, timeout до 5 мин.

### 2026-04-13 — Новый SUNO аккаунт, 2500 credits
Cookie захвачен через `Network.getAllCookies` CDP (единственный способ получить httpOnly `__client`).

### 2026-04-13 — Очередь генерации (commit 700eaef)
Серийная очередь — 1 генерация за раз. Пользователь видит позицию и время ожидания (~4 мин/чел).

### 2026-04-13 — Коды доступа для бета-теста (commit 10709ef)
20 уникальных 6-значных кодов. Каждый привязывается к одному Telegram userId.
`/codes` — команда для просмотра статуса кодов.

### 2026-04-13 — Умные SUNO теги (commit 5de276a)
AI возвращает JSON `{lyrics, tags}`. Теги — английские дескрипторы из любого ввода:
артист, опечатки, BPM, русский текст → SUNO-совместимые теги.

## Репозиторий

- GitHub: papavini/moyapesnya
- Бот: @podaripesniu_bot
- Сервер: 192.168.0.128 (Debian 13)
- SSH пользователь: alexander
