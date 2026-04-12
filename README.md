# Подари Песню! — Telegram-бот для создания персональных песен

Telegram-бот `@podaripesniu_bot`, который ведёт пользователя через 5 вопросов, генерирует текст песни через AI (Gemini), и превращает его в настоящую песню через SUNO.

**GitHub:** [papavini/moyapesnya](https://github.com/papavini/moyapesnya)

---

## Архитектура

Мини ПК `192.168.0.128` (Debian 13, 4 ядра, 16GB RAM):

```
Пользователь Telegram
        │
        ▼
┌───────────────────────────┐
│  Telegram Bot (Docker)    │  Node.js 22 + grammY 1.30
│  @podaripesniu_bot        │  long-polling
│  контейнер: suno-bot      │
└───────────┬───────────────┘
            │
    ┌───────┴───────┐
    │               │
    ▼               ▼
┌────────────┐  ┌─────────────────┐
│ OpenRouter │  │ suno-api        │  Next.js (native, systemd)
│ Gemini 3.1 │  │ localhost:3000  │  обёртка над SUNO
│ Flash Lite │  │ Cookies → file  │
└────────────┘  └────────┬────────┘
                         │ HTTPS
                         ▼
                     suno.com

┌──────────────────────────────┐
│  Cloudflare Tunnel (systemd) │
│  pay.vrodnikah.ru → :8080    │  для Robokassa webhook
└──────────────────────────────┘
```

### Сервисы на мини ПК

| Сервис | Тип | Порт | Управление |
|---|---|---|---|
| **suno-bot** | Docker | — (long-polling) | `docker compose restart bot` |
| **suno-api** | systemd (native) | 3000 | `sudo systemctl restart suno-api` |
| **cloudflared** | systemd | — | `sudo systemctl restart cloudflared` |
| **passkey-server** | systemd | 3099 | `sudo systemctl restart passkey-server` |
| **webhook** | внутри бота | 8080 | перезапуск вместе с ботом |

---

## Стек технологий

| Компонент | Технология |
|---|---|
| Бот | Node.js 22, grammY 1.30, undici |
| AI тексты | google/gemini-3.1-flash-lite-preview через OpenRouter |
| Музыка | SUNO (suno.com) через suno-api (gcui-art/suno-api fork) |
| Оплата | Robokassa (подготовлено, тестовый режим) |
| Webhook tunnel | Cloudflare Tunnel → pay.vrodnikah.ru |
| Контейнеризация | Docker (бот), systemd (suno-api, cloudflared) |
| DNS | Cloudflare (vrodnikah.ru) |

---

## Флоу пользователя

```
/start
  └─► Приветственное видео + blockquote текст
        └─► 🔥 "Создать свою песню" (красная кнопка)
              └─► Q1: Повод (8 кнопок + Свой вариант)
                    └─► Q2: Жанр (7 кнопок + Свой стиль)
                          └─► Q3: Настроение (4 кнопки)
                                └─► Q4: Голос (Мужской 🔴 / Женский 🟢)
                                      └─► Q5: Пожелания (текст или 🎙 голос)
                                            └─► Подтверждение (итог выборов)
                                                  └─► 🔥 "Создать текст песни"
                                                        └─► ✍️ AI генерирует текст (Gemini)
                                                              └─► 📝 Показ текста + мотивация
                                                                    ├─► 🔥 "Создать песню" → SUNO
                                                                    └─► 📝 "Изменить текст" → AI правки
                                                                          └─► Обновлённый текст
                                                                                └─► 🔥 "Создать песню"
                                                                                      └─► [ОПЛАТА 299₽]*
                                                                                            └─► Прогресс ❤️🖤
                                                                                                  └─► 🎵 MP3
```

*Оплата пока отключена (`PAYWALL_ENABLED=false`). Robokassa подготовлена.

### Особенности UI
- Видео кешируется через `file_id` (не загружается повторно)
- Кнопки удаляются после нажатия (чистый чат)
- Все тексты в `<blockquote>` с HTML parse_mode
- Красные/зелёные кнопки через `.danger()` / `.success()`
- Везде упоминание 🎙 микрофона (STT в планах)
- Ошибки скрывают бэкенд (нет "SUNO" в сообщениях пользователю)

---

## Установка (мини ПК)

### 1. suno-api (нативно, не Docker)

```bash
cd ~/projects
git clone -b feature/passkey-automation https://github.com/papavini/suno-api.git
cd suno-api
npm install
npm run build
```

Cookie извлекаются из Chromium через CDP:
```bash
# На мини ПК с GUI:
chromium --remote-debugging-port=9222 --remote-allow-origins=* https://suno.com/create &

# Извлечь cookies (Python):
python3 extract_cookies.py  # → сохраняет в ~/projects/suno_cookie.txt
```

Systemd сервис:
```bash
sudo systemctl enable suno-api
sudo systemctl start suno-api
```

### 2. Бот (Docker)

```bash
cd ~/projects/moyapesnya
git pull
cd ~/projects
docker compose build bot
docker compose up -d bot
```

### 3. Cloudflare Tunnel

```bash
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
# pay.vrodnikah.ru → localhost:8080
```

---

## Переменные окружения

### Бот (`moyapesnya/.env`)

| Переменная | Обязательна | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Да | `8527511589:AAFM4se...` от @BotFather |
| `SUNO_API_BASE` | Нет | URL suno-api (дефолт: `http://localhost:3000`) |
| `OPENROUTER_API_KEY` | Да | Ключ OpenRouter для AI генерации текстов |
| `AI_MODEL` | Нет | Дефолт: `google/gemini-3.1-flash-lite-preview` |
| `SUNO_POLL_TIMEOUT_SEC` | Нет | Таймаут ожидания трека (дефолт: 480) |
| `SUNO_POLL_INTERVAL_SEC` | Нет | Интервал опроса (дефолт: 5) |
| `SUNO_SEND_FIRST_ONLY` | Нет | Только 1 клип из 2 (дефолт: false) |
| `PAYWALL_ENABLED` | Нет | Включить оплату (дефолт: false) |
| `ROBOKASSA_MERCHANT_ID` | Нет | ID магазина Robokassa |
| `ROBOKASSA_PASSWORD1` | Нет | Пароль #1 для подписи |
| `ROBOKASSA_PASSWORD2` | Нет | Пароль #2 для проверки |
| `ROBOKASSA_TEST_MODE` | Нет | Тестовый режим (дефолт: true) |
| `SONG_PRICE` | Нет | Цена песни в рублях (дефолт: 299) |
| `WEBHOOK_PORT` | Нет | Порт webhook сервера (дефолт: 8080) |

### suno-api

Cookie читаются из файла `~/projects/suno_cookie.txt` (не из .env — Docker ломает `$` в cookie-строке).

---

## Структура файлов

```
SUNO Бот Sales/
├── src/
│   ├── index.js              # entrypoint: бот + webhook сервер
│   ├── config.js             # .env → config объект
│   ├── store.js              # in-memory сессии + платежи
│   ├── assets/
│   │   ├── welcome.mp4       # приветственное видео (10MB)
│   │   └── .video_file_id    # кеш Telegram file_id
│   ├── ai/
│   │   └── client.js         # OpenRouter API → Gemini Flash Lite
│   ├── suno/
│   │   └── client.js         # HTTP клиент к suno-api + ensureTokenAlive()
│   ├── payment/
│   │   └── robokassa.js      # генерация URL оплаты, проверка MD5 подписи
│   ├── server/
│   │   └── webhook.js        # HTTP сервер :8080 для Robokassa callback
│   ├── flow/
│   │   └── generate.js       # pre-flight → submit → poll → return clips
│   └── bots/
│       ├── telegram.js       # grammY: полный флоу с AI + оплатой
│       └── vk.js             # vk-io (не тестировался)
├── emulator/
│   └── index.html            # веб-эмулятор бота (localhost:5555)
├── Dockerfile                # Docker образ бота
├── .env.example              # шаблон переменных
└── package.json
```

---

## Стейт-машина

```
idle
  └─► awaiting_occasion
        └─► awaiting_occasion_custom (свой вариант)
        └─► awaiting_genre
              └─► awaiting_genre_custom (свой стиль)
              └─► awaiting_mood
                    └─► awaiting_voice
                          └─► awaiting_wishes
                                └─► confirm (итог)
                                      └─► review_lyrics (AI текст)
                                            └─► editing_lyrics (правки)
                                            └─► awaiting_payment (Robokassa)
                                            └─► generating (SUNO)
                                                  └─► idle
```

---

## Обновление cookies SUNO

Cookies протухают через ~24-48 часов. Обновление:

1. На мини ПК запусти Chromium:
   ```bash
   pkill chromium; sleep 2
   chromium --remote-debugging-port=9222 --remote-allow-origins=* https://suno.com/create &
   ```

2. Через SSH извлеки cookies:
   ```bash
   python3 -c "
   import json, urllib.request, websocket
   tabs = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json/list').read())
   ws = websocket.create_connection(tabs[0]['webSocketDebuggerUrl'])
   ws.send(json.dumps({'id':1,'method':'Network.getCookies','params':{'urls':['https://suno.com','https://studio-api-prod.suno.com','https://auth.suno.com']}}))
   result = json.loads(ws.recv())
   ws.close()
   cookies = result['result']['cookies']
   cookie_str = '; '.join(f\"{c['name']}={c['value']}\" for c in cookies if c.get('value'))
   open('/home/alexander/projects/suno_cookie.txt','w').write(cookie_str)
   print(f'OK: {len(cookies)} cookies')
   "
   ```

3. Перезапусти suno-api:
   ```bash
   sudo systemctl restart suno-api
   ```

---

## Robokassa (оплата)

| Параметр | Значение |
|---|---|
| Merchant ID | `podaripesniu` |
| Result URL | `https://pay.vrodnikah.ru/robokassa/result` (POST) |
| Success URL | `https://t.me/podaripesniu_bot` (GET) |
| Fail URL | `https://t.me/podaripesniu_bot` (GET) |
| Тестовый режим | Включён (`ROBOKASSA_TEST_MODE=true`) |
| Цена | 299 руб |

**Статус:** Заявка на активацию подана. Тестовые платежи работают.

Для включения: `PAYWALL_ENABLED=true` в `.env` бота.

---

## Кредиты SUNO

- Один запрос = **~30 кредитов** (2 клипа)
- Pro Plan: **2500 кредитов/месяц** = ~83 генерации
- Проверить: `curl http://localhost:3000/api/get_limit`
- Генерация: **2-5 минут**

---

## Команды бота

| Команда | Описание |
|---|---|
| `/start` | Начать заново |
| `/cancel` | Отменить |
| `/ping` | Проверка связи + кредиты |

---

## Деплой обновлений

```bash
# На Windows:
cd "SUNO Бот Sales"
git add -A && git commit -m "description" && git push

# На мини ПК (через SSH):
cd ~/projects/moyapesnya && git pull
cd ~/projects && docker compose build bot && docker compose up -d --force-recreate bot
```

---

## Траблшутинг

| Проблема | Решение |
|---|---|
| `Token validation failed` | Cookies протухли → обновить через CDP (см. выше) |
| Бот не отвечает | `docker logs suno-bot --tail 20` |
| suno-api упал | `sudo systemctl status suno-api` + `journalctl -u suno-api -n 30` |
| Tunnel не работает | `sudo systemctl status cloudflared` + проверить DNS |
| AI текст не приходит | Проверить `OPENROUTER_API_KEY` в `.env` бота |
| Docker ломает cookies | suno-api запускать **нативно** (systemd), не Docker |

---

## TODO

- [ ] STT: расшифровка голосовых через Gemini
- [ ] Активация Robokassa → включить `PAYWALL_ENABLED=true`
- [ ] Автообновление cookies через cron + CDP
- [ ] Redis для сессий
- [ ] PostgreSQL: пользователи, заказы, история
- [ ] Rate limiting
- [ ] Webhook-режим бота (вместо long-polling)
- [ ] VK бот (тестирование)
