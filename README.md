# Подари Трек — Telegram-бот для продажи персональных песен

Telegram-бот (@chingaresendbot / @podaritrackAi_bot), который ведёт пользователя через 5 вопросов, генерирует промпт и возвращает готовый трек из SUNO. MVP без оплаты — сначала отлаживаем флоу, монетизация подключается позже.

## Архитектура

Три сервиса в Docker на мини ПК (192.168.0.128, Debian 13):

```
Пользователь Telegram
        │
        ▼
┌──────────────────────┐
│  SUNO Бот Sales      │  Node.js 22 + grammY
│  src/bots/telegram.js│  long-polling
│  Docker: suno-bot    │
└──────────┬───────────┘
           │ HTTP localhost:3000
           ▼
┌──────────────────────┐
│  suno-api            │  Next.js (gcui-art/suno-api)
│  Docker: suno-api    │  обёртка над SUNO
│  localhost:3000      │
└──────────┬───────────┘
           │ HTTPS API
           ▼
       suno.com

┌──────────────────────┐
│  Gemini Flash Lite   │  google/gemini-3.1-flash-lite-preview
│  через OpenRouter    │  генерация текстов песен + STT
└──────────────────────┘
```

**Сервис 1 — бот** (`SUNO Бот Sales/`):
- Ведёт диалог с пользователем (приветственное видео + 5 вопросов)
- Собирает ответы → AI генерирует текст песни → вызывает suno-api
- Pre-flight проверка токена перед генерацией (ensureTokenAlive)
- Опрашивает suno-api каждые 5 сек до готовности трека
- Отправляет аудиофайл пользователю
- Кнопки удаляются после выбора, blockquote стиль

**Сервис 2 — suno-api** (`suno-api/`):
- Прокси-обёртка над SUNO. Форк: [papavini/suno-api](https://github.com/papavini/suno-api)
- Авторизуется через cookie (passkey token НЕ нужен для Pro Plan!)
- Эндпоинты: `POST /api/generate`, `POST /api/custom_generate`, `GET /api/get?ids=`, `GET /api/get_limit`

**Сервис 3 — AI-генерация текстов** (планируется):
- Модель: `google/gemini-3.1-flash-lite-preview` через OpenRouter API
- Генерация текстов песен из пожеланий пользователя
- STT: расшифровка голосовых сообщений в текст

---

## Флоу пользователя (5 вопросов)

```
/start
  └─► Приветственное видео + blockquote текст + кнопка "Создать свою песню" (красная)
        └─► Q1: Повод (8 кнопок + Свой вариант) — кнопки исчезают после выбора
              └─► Q2: Жанр (7 кнопок)
                    └─► Q3: Настроение (4 кнопки)
                          └─► Q4: Голос (Мужской / Женский)
                                └─► Q5: Свободный текст (пожелания)
                                      └─► Подтверждение (итог всех выборов)
                                            └─► "Создать песню" (красная) / "Внести правки"
                                                  └─► Pre-flight проверка токена
                                                        └─► Мотивационное сообщение
                                                              └─► Прогресс-бар ❤️🖤
                                                                    └─► 2 аудиофайла MP3
```

Ответы накапливаются в сессии через `setState` (merge-патч). После Q5 вызывается `buildPrompt`:

```js
`Создай полноценную душевную песню на русском языке.
Повод: ${occasion}. Жанр: ${genre}. Настроение: ${mood}. ${voice}.
Пожелания и история: ${wishes}.
Сделай трогательно, с припевом, куплетами и бриджем. Упомяни имя и детали из истории.`
```

---

## Требования

- Node.js 20+
- Запущенный suno-api (localhost:3000)
- Аккаунт на suno.com с активной подпиской

---

## Установка

### 1. suno-api

```bash
git clone https://github.com/gcui-art/suno-api.git
cd suno-api
npm install
```

Заполни `.env` (см. `suno-api/SETUP.md`):

```env
SUNO_COOKIE=<полная cookie-строка с suno.com>
SUNO_PASSKEY_TOKEN=<P1_eyJ... — см. ниже как получить>
SUNO_USER_TIER=<UUID тира — из cookie __session>
SUNO_CREATE_SESSION_TOKEN=<UUID — из cookie>
BROWSER=chromium
BROWSER_HEADLESS=true
TWOCAPTCHA_KEY=
```

Собери и запусти:

```bash
npm run build
npm start
# Должен слушать на :3000
# Проверка: curl http://localhost:3000/api/get_limit
```

### 2. Бот

```bash
cd "SUNO Бот Sales"
npm install
cp .env.example .env
```

Заполни `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...   # от @BotFather
SUNO_API_BASE=http://localhost:3000
SUNO_POLL_TIMEOUT_SEC=480
SUNO_POLL_INTERVAL_SEC=5
SUNO_SEND_FIRST_ONLY=false
PAYWALL_ENABLED=false
```

Запусти:

```bash
npm run start:tg
```

---

## Запуск на Linux (продакшн) — Docker

Деплой на мини ПК (192.168.0.128, Debian 13, Docker 29.4):

```bash
ssh alexander@192.168.0.128
cd ~/projects

# Структура:
# ~/projects/docker-compose.yml
# ~/projects/moyapesnya/     — бот (papavini/moyapesnya)
# ~/projects/suno-api/       — API (papavini/suno-api, ветка feature/passkey-automation)

# Сборка и запуск
docker compose build
docker compose up -d

# Проверка
docker ps
docker logs suno-bot --tail 20
docker logs suno-api --tail 20
curl http://localhost:3000/api/get_limit

# Обновление бота после git push
cd ~/projects/moyapesnya && git pull
cd ~/projects && docker compose build bot && docker compose up -d --force-recreate bot
```

> **Важно:** Docker bridge network не работает на этом сервере (HTTP заблокирован). Используется `network_mode: host` + `build.network: host`.

---

## Переменные окружения бота

| Переменная | Обязательна | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Да | Токен от @BotFather |
| `SUNO_API_BASE` | Нет | URL suno-api (дефолт: `http://localhost:3000`) |
| `SUNO_POLL_TIMEOUT_SEC` | Нет | Таймаут ожидания трека, сек (дефолт: 240) |
| `SUNO_POLL_INTERVAL_SEC` | Нет | Интервал опроса, сек (дефолт: 5) |
| `SUNO_SEND_FIRST_ONLY` | Нет | Отправлять только первый клип из двух (дефолт: false) |
| `PAYWALL_ENABLED` | Нет | Включить оплату (дефолт: false, MVP) |
| `VK_GROUP_TOKEN` | Нет | Токен VK (бот запустится без него) |
| `VK_GROUP_ID` | Нет | ID группы VK |

---

## Passkey token SUNO

> **Pro Plan аккаунты НЕ нуждаются в passkey токене!** SUNO веб-клиент отправляет `"token": null` для Pro Plan. Наш suno-api работает без токена.

Если что-то сломается — cookie (`SUNO_COOKIE`) нужно обновить вручную из браузера. `keepAlive()` в suno-api автоматически обновляет JWT сессию.

---

## Команды бота

| Команда | Описание |
|---|---|
| `/start` | Запустить диалог заново |
| `/cancel` | Отменить текущий диалог |
| `/ping` | Проверить связь с SUNO (показывает кредиты) |

---

## Структура файлов

```
SUNO Бот Sales/
├── src/
│   ├── index.js           # entrypoint: поднимает ботов, SIGINT/SIGTERM
│   ├── config.js          # загрузка .env, дефолты
│   ├── store.js           # in-memory сессии: state + data через setState
│   ├── assets/
│   │   └── welcome.mp4    # приветственное видео (10MB, кешируется file_id)
│   ├── suno/
│   │   └── client.js      # HTTP-клиент к suno-api + ensureTokenAlive()
│   ├── flow/
│   │   └── generate.js    # submit → pre-flight check → poll → return clips
│   └── bots/
│       ├── telegram.js    # grammY: видео, blockquote, 5 вопросов, красные кнопки
│       └── vk.js          # vk-io: аналогичный флоу
├── emulator/
│   ├── index.html         # веб-эмулятор бота для тестирования UI
│   └── welcome.mp4        # копия видео для эмулятора
├── Dockerfile             # Docker-образ для бота
├── .env                   # секреты (в git не включать!)
├── .env.example           # шаблон
├── .gitignore
└── package.json
```

---

## Стейт-машина (store.js)

```
idle
  └─► awaiting_occasion        (Q1: повод)
        │  └─► awaiting_occasion_custom  (текстовый ввод своего варианта)
        └─► awaiting_genre            (Q2: жанр)
              └─► awaiting_mood       (Q3: настроение)
                    └─► awaiting_voice (Q4: голос)
                          └─► awaiting_wishes  (Q5: свободный текст)
                                └─► confirm  (подтверждение с итогом)
                                      └─► generating  (pre-flight + SUNO)
                                            └─► idle  (сброс после результата)
```

`setState(platform, userId, state, patch)` делает merge `data = {...data, ...patch}`, поэтому ответы Q1–Q4 накапливаются и все доступны на шаге Q5.

---

## Кредиты SUNO

- Один запрос генерации = **~30 кредитов** (2 клипа по ~15)
- Лимит Pro-плана: **2500 кредитов/месяц** ≈ 83 генерации
- Проверить остаток: `curl http://localhost:3000/api/get_limit`
- Время генерации: **2–5 минут** (зависит от загрузки серверов SUNO)

---

## Траблшутинг

### 422 от SUNO при генерации
Протух `SUNO_PASSKEY_TOKEN`. Обнови по инструкции выше.

### Бот не отвечает после /start
- Проверь `TELEGRAM_BOT_TOKEN` в `.env`
- Убедись что suno-api запущен: `curl http://localhost:3000/api/get_limit`

### Генерация зависла навсегда
- Дефолтный таймаут 480 сек. После него бот отправит ошибку.
- Проверь логи suno-api: `journalctl -u suno-api -n 50`
- Если в логах `Get audio status` повторяется без изменений — suno-api делает polling, но SUNO медленно отвечает. Это нормально.

### replyWithAudio не работает, бот присылает ссылку
- Telegram не смог подтянуть файл по URL (CDN suno.com иногда требует авторизацию)
- В коде есть fallback: отправляет текст со ссылкой вместо файла

### После обновления .env изменения не применились
- suno-api надо **пересобрать**: `npm run build && sudo systemctl restart suno-api`
- Бот читает `.env` при каждом старте — просто перезапусти: `sudo systemctl restart podaritrack-bot`

---

## TODO (следующие итерации)

- [ ] Оплата: Telegram Stars / ЮKassa / CryptoBot
- [ ] Тарифы: бесплатный пробник (1 трек) + пакеты
- [ ] Redis для сессий (сейчас сессии теряются при рестарте)
- [ ] PostgreSQL/SQLite: пользователи, заказы, история
- [ ] Rate limiting (анти-абуз)
- [ ] Автообновление SUNO_PASSKEY_TOKEN (браузерная автоматизация)
- [ ] Docker Compose (бот + suno-api + redis)
- [ ] Логирование в файл через pino
- [ ] Webhook-режим вместо long-polling (для высоких нагрузок)
- [ ] Поддержка VK (протестировать и отладить)
