# Структура проекта

```
SUNO Бот Sales/
├── src/
│   ├── index.js                # Точка входа: запускает TG/VK ботов, ping SUNO
│   ├── config.js               # Все настройки из .env (config объект)
│   ├── store.js                # In-memory хранилище сессий и платежей
│   │
│   ├── bots/
│   │   ├── telegram.js         # Основной бот (~680 строк): весь UI/UX флоу
│   │   └── vk.js               # VK-бот (упрощённый, без AI текстов)
│   │
│   ├── flow/
│   │   └── generate.js         # Оркестратор: ensureToken → generate → waitForClips
│   │
│   ├── suno/
│   │   ├── client.js           # HTTP клиент к suno-api: generate, poll, ping, retry
│   │   └── refresh-passkey.js  # CDP: кликает Create на suno.com, перехватывает P1_
│   │
│   ├── ai/
│   │   └── client.js           # OpenRouter → Gemini: генерация текстов песен
│   │
│   ├── payment/
│   │   └── robokassa.js        # Создание invoice URL + верификация подписи
│   │
│   ├── server/
│   │   └── webhook.js          # HTTP :8080: /robokassa/result, /health
│   │
│   └── assets/
│       ├── welcome.mp4         # Приветственное видео
│       └── .video_file_id      # Кэш file_id видео (чтобы не загружать повторно)
│
├── docs/                       # Документация проекта
│   ├── architecture.md         # Архитектура, стек, поток данных
│   ├── structure.md            # Этот файл — где что лежит
│   ├── flow.md                 # Пользовательский флоу пошагово
│   └── progress.md             # Текущий статус и история изменений
│
├── emulator/
│   ├── index.html              # Эмулятор бота (локальный UI для тестов)
│   └── welcome.mp4             # Копия видео для эмулятора
│
├── .claude/
│   ├── settings.json           # Хуки Claude Code (авто-чтение/запись CONTINUITY.md + docs)
│   └── settings.local.json     # Локальные разрешения Claude Code
│
├── .env                        # Секреты и конфиг (не коммитится)
├── .env.example                # Шаблон .env
├── CONTINUITY.md               # Ledger сессий Claude (состояние/цели/решения)
├── CLAUDE.md                   # Инструкции для Claude Code
├── package.json
└── README.md                   # Основная документация для разработчика
```

## Ключевые зависимости

```json
{
  "grammy": "^1.30.0",    // Telegram Bot API
  "undici": "^6.19.8",   // HTTP клиент (fetch)
  "ws": "^8.20.0",       // WebSocket для CDP
  "vk-io": "^4.9.0",    // VK Bot API
  "dotenv": "^16.4.5"   // Загрузка .env
}
```

## Переменные окружения (.env)

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `SUNO_API_BASE` | URL suno-api (обычно http://localhost:3000) |
| `SUNO_POLL_TIMEOUT_SEC` | Таймаут ожидания трека (480 сек) |
| `SUNO_SEND_FIRST_ONLY` | Слать только первый трек из двух |
| `OPENROUTER_API_KEY` | Ключ OpenRouter для Gemini |
| `AI_MODEL` | Модель AI (google/gemini-3.1-flash-lite-preview) |
| `PAYWALL_ENABLED` | Включить оплату (true/false) |
| `SONG_PRICE` | Цена песни в рублях (299) |
| `ROBOKASSA_MERCHANT_ID` | ID магазина Robokassa |
| `ROBOKASSA_PASSWORD1/2` | Пароли Robokassa |
| `ROBOKASSA_TEST_MODE` | Тестовый режим Robokassa |
| `WEBHOOK_PORT` | Порт webhook сервера (8080) |
| `VK_GROUP_TOKEN` | Токен VK группы (опционально) |
| `VK_GROUP_ID` | ID VK группы (опционально) |
