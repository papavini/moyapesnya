# Подари Трек — Telegram-бот для продажи персональных песен

Telegram-бот (@chingaresendbot / @podaritrackAi_bot), который ведёт пользователя через 5 вопросов, генерирует промпт и возвращает готовый трек из SUNO. MVP без оплаты — сначала отлаживаем флоу, монетизация подключается позже.

## Архитектура

Два отдельных Node.js-сервиса, каждый со своим `.env`:

```
Пользователь Telegram
        │
        ▼
┌──────────────────────┐
│  SUNO Бот Sales      │  Node.js + grammY
│  src/bots/telegram.js│  long-polling
│  порт не нужен       │
└──────────┬───────────┘
           │ HTTP GET/POST localhost:3000
           ▼
┌──────────────────────┐
│  suno-api            │  Next.js (gcui-art/suno-api)
│  localhost:3000      │  обёртка над SUNO
└──────────┬───────────┘
           │ HTTPS API
           ▼
       suno.com
```

**Сервис 1 — бот** (`SUNO Бот Sales/`):
- Ведёт диалог с пользователем
- Собирает 5 ответов → строит промпт → вызывает suno-api
- Опрашивает suno-api каждые 5 сек до готовности трека
- Отправляет аудиофайл пользователю

**Сервис 2 — suno-api** (`suno-api/`):
- Прокси-обёртка над SUNO. Репозиторий: [gcui-art/suno-api](https://github.com/gcui-art/suno-api)
- Авторизуется через cookie + passkey token
- Эндпоинты: `POST /api/generate`, `GET /api/get?ids=`, `GET /api/get_limit`

---

## Флоу пользователя (5 вопросов)

```
/start
  └─► Приветствие + кнопка "Создать свою песню"
        └─► Q1: Повод (8 кнопок + Свой вариант)
              └─► Q2: Жанр (7 кнопок)
                    └─► Q3: Настроение (4 кнопки)
                          └─► Q4: Голос (Мужской / Женский)
                                └─► Q5: Свободный текст (пожелания)
                                      └─► Мотивационное сообщение
                                            └─► Прогресс-бар ❤️🖤 (10%→55%→90%→100%)
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

## Запуск на Linux (продакшн)

### systemd-сервис для suno-api

Создай файл `/etc/systemd/system/suno-api.service`:

```ini
[Unit]
Description=SUNO API proxy
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/suno-api
ExecStart=/usr/bin/node_modules/.bin/next start
# или просто: ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
EnvironmentFile=/home/ubuntu/suno-api/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### systemd-сервис для бота

Создай файл `/etc/systemd/system/podaritrack-bot.service`:

```ini
[Unit]
Description=Podari Track Telegram Bot
After=network.target suno-api.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/podaritrack-bot
ExecStart=/usr/bin/node src/index.js --only=telegram
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/ubuntu/podaritrack-bot/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Активация

```bash
sudo systemctl daemon-reload
sudo systemctl enable suno-api podaritrack-bot
sudo systemctl start suno-api
sleep 5
sudo systemctl start podaritrack-bot

# Проверка
sudo systemctl status suno-api
sudo systemctl status podaritrack-bot
journalctl -u podaritrack-bot -f   # живые логи
```

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

## Passkey token SUNO — как обновлять

SUNO использует ротируемый `P1_eyJ...` токен (HS256 JWT от Cloudflare), который **протухает** через несколько часов/дней. Когда генерация возвращает 422 — нужен новый токен.

**Как получить:**

1. Открой Chrome, зайди на `https://suno.com/create`
2. Открой DevTools → Console
3. Нажми кнопку Create (сгенерируй любую песню)
4. В консоли появится строка: `captcha verified P1_eyJ...`
5. Скопируй токен целиком (очень длинный)
6. Вставь в `suno-api/.env`:
   ```env
   SUNO_PASSKEY_TOKEN=P1_eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
   ```
7. Пересобери и перезапусти suno-api:
   ```bash
   npm run build && npm start
   # или через systemd:
   sudo systemctl restart suno-api
   ```

> **Важно:** suno-api нужно **пересобирать** (`npm run build`) после изменения `.env`, потому что Next.js запекает переменные при сборке. Иначе `npm start` поднимет старый билд со старым токеном.

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
│   ├── store.js           # in-memory сессии: state + data накапливаются через setState
│   ├── suno/
│   │   └── client.js      # HTTP-клиент к suno-api (generate, getClips, waitForClips, ping)
│   ├── flow/
│   │   └── generate.js    # платформонезависимый флоу: submit → poll → return clips
│   └── bots/
│       ├── telegram.js    # grammY: 5-вопросный визард, прогресс-бар, replyWithAudio
│       └── vk.js          # vk-io: аналогичный флоу (не тестировался в этой итерации)
├── .env                   # секреты (в git не включать!)
├── .env.example           # шаблон
├── .gitignore
├── package.json
├── start.bat              # запуск на Windows
└── start.ps1              # запуск на Windows через PowerShell
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
                                └─► generating  (ждём SUNO)
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
