# История изменений и текущий статус

## Текущий статус (апрель 2026)

| Компонент | Статус |
|---|---|
| Telegram бот — основной флоу | ✅ Работает |
| Доступ по коду (бета-тест) | ✅ Активен (20 кодов) |
| AI генерация текстов (Gemini) | ✅ Работает |
| SUNO генерация треков | ✅ Работает |
| Passkey auto-refresh (CDP) | ✅ Работает |
| Retry on 422 | ✅ Работает |
| Robokassa paywall | ⏸ Выключена (PAYWALL_ENABLED=false) |
| VK-бот | ⏸ Отключён (токен не задан) |
| Голосовые сообщения (STT) | 🔲 Не реализовано |
| Редактирование текста (AI) | ✅ Работает |

## Ключевые технические решения

### Docker → systemd
Docker не используется: `$` в cookies ломает env_file синтаксис.
Все сервисы запущены как systemd units напрямую.

### Cookie из файла
`suno-api` читает cookie из `~/projects/suno_cookie.txt`, не из .env.

### Passkey P1_ токен
- JWT HS256, ~1900 chars, живёт ~30 мин в React state браузера
- Источник: CF Turnstile invisible challenge на `/create` — завершается за 30-60 сек
- Захват: CDP → навигация /create → ждём 60s → fill form → click Create → Fetch.failRequest перехватывает generate body → P1_ извлечён (кредиты не тратятся)
- Расписание: при старте бота + каждые 25 мин (src/index.js)
- При ответе 422 — автоматический retry: refresh → 8 сек пауза → повтор запроса
- RDP Chromium на сервере: CDP порт 9223, реальная сессия sonarliktor
- Ручное восстановление: `node /tmp/get_p1_hardreload.mjs` на сервере

### SUNO endpoint
- Используем `/api/generate/v2-web/` (не `/api/generate/v2/`)
- Модель: `chirp-fenix` (v5.5)
- Polling по статусу: ждём `complete` (не `streaming` — это только ~30 сек превью)

### Store in-memory
Сессии и платежи хранятся в RAM. При рестарте сервиса — теряются.
Для продакшна нужен Redis или SQLite.

### Кэш video file_id
Приветственное видео загружается один раз, потом Telegram file_id кэшируется
в `src/assets/.video_file_id` — повторные отправки без загрузки файла.

## Известные проблемы

1. `vk.js` в команде `/ping` упоминает слово "SUNO" пользователю (нарушение правила)
2. `store.js` — in-memory: рестарт сервера теряет все незавершённые сессии/платежи
3. Голосовые сообщения — заглушка, STT не реализован
4. SUNO transient errors: иногда SUNO возвращает clips со status=`error` и `audio_url: cdn1.suno.ai/None.mp3` — server-side rendering failure, credits всё равно списываются, повтор генерации обычно работает

## Деплой

```bash
# На локальной машине:
git add -A && git commit -m "msg" && git push origin main

# На сервере:
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 \
  'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-bot'
```

## История ключевых изменений

### 2026-04-13 — Passkey: фикс CF Turnstile (commit d2451d1)
**Проблема:** P1_ = null при каждом авто-refresh.  
**Причина:** CF Turnstile invisible challenge занимает 30-60 сек, код ждал 20 сек.  
**Фикс:** увеличили ожидание до 60 сек, timeout до 5 мин.  
**Результат:** startup timer OK, плановые refresh стабильны.

### 2026-04-13 — Proactive passkey timer (commit 400b2b6)
Добавлен таймер в index.js: refresh при старте + каждые 25 мин.  
До этого P1_ обновлялся только при 422 (реактивно).

### 2026-04-13 — Новый SUNO аккаунт, 2500 credits
Подключён новый аккаунт. Cookie захвачен через `Network.getAllCookies` CDP (единственный способ получить httpOnly `__client`). P1_ обновлён. Credits: 2500/2500.

### 2026-04-13 — AI модель: deepseek/deepseek-v3-2 (commit 9e21024)
Сменили с google/gemini-3.1-flash-lite-preview. DeepSeek сильнее в творческих текстах.

### 2026-04-13 — Очередь генерации (commit 700eaef)
Серийная очередь — 1 генерация за раз. Пользователь видит позицию и время ожидания (~4 мин/чел).

### 2026-04-13 — Коды доступа для бета-теста (commit 10709ef)
20 уникальных 6-значных кодов. Каждый привязывается к одному Telegram userId.
`/codes` — команда для просмотра статуса кодов.

### 2026-04-13 — Умные SUNO теги + лимит 150 слов (commit 5de276a)
Gemini возвращает JSON `{lyrics, tags}`. Теги — английские дескрипторы из любого ввода:
артист, опечатки, BPM, русский текст → SUNO-совместимые теги.

### 2026-04-13 — Passkey через Fetch.failRequest (commit 1e896cf)
Перешли с `Fetch.continueRequest` на `Fetch.failRequest`: P1_ извлекается из тела запроса, сам запрос отменяется — кредиты не тратятся.

## Репозиторий

- GitHub: papavini/moyapesnya
- Бот: @podaripesniu_bot
- Сервер: 192.168.0.128 (Debian 13)
- SSH пользователь: alexander
