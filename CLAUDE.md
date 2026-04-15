## Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)`. The ledger is the canonical session briefing designed to survive context compaction; do not rely on earlier chat text unless it’s reflected in the ledger.

### How it works
- At the start of every assistant turn: read `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)`, update it to reflect the latest goal/constraints/decisions/state, then proceed with the work.
- Update `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` again whenever any of these change: goal, constraints/assumptions, key decisions, progress state (Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as `UNCONFIRMED` (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps `UNCONFIRMED`, ask up to 1–3 targeted questions, then continue.

### `functions.update_plan` vs the Ledger
- `functions.update_plan` is for short-term execution scaffolding while you work (a small 3–7 step plan with pending/in_progress/completed).
- `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` is for long-running continuity across compaction (the “what/why/current state”), not a step-by-step task list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

### In replies
- Begin with a brief “Ledger Snapshot” (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or when the user asks.

### `
http://
CONTINUITY.md (https://t.co/Navn22TRF7)` format (keep headings)
- Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
- Done:
- Now:
- Next:
- Open questions (UNCONFIRMED if needed):
- Working set (files/ids/commands):



# Подари Песню! — Telegram-бот

## Быстрый старт
- **Репо:** [papavini/moyapesnya](https://github.com/papavini/moyapesnya)
- **Бот:** `@podaripesniu_bot`
- **Сервер:** мини ПК 192.168.0.128 (Debian 13, SSH через WSL)

## SSH
```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'команда'
```

## Деплой
```bash
git add -A && git commit -m "msg" && git push origin main
# Потом на сервере:
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128 'cd ~/projects/moyapesnya && git pull && npm install && sudo systemctl restart podari-bot'
```

## Сервисы на мини ПК (всё systemd, Docker НЕ используется)
- `podari-bot` — Telegram бот
- `suno-api` — SUNO proxy (cookie из файла ~/projects/suno_cookie.txt)
- `passkey-server` — HTTP :3099, принимает P1_ токены
- `cloudflared` — Cloudflare Tunnel (pay.vrodnikah.ru → :8080)
- `cookie-refresh.timer` — обновление cookies каждые 25 мин
- `chromium-watchdog.timer` — проверка Chromium каждые 5 мин

## Критические знания
1. **Docker НЕ используется** — `$` в cookies ломает Docker env_file
2. **suno-api читает cookie из файла** — не из .env
3. **Passkey P1_ token живёт ~30 мин** — при 422 бот автоматически кликает Create через CDP и повторяет
4. **SUNO endpoint:** `/api/generate/v2-web/` (не v2!)
5. **SUNO модель:** `chirp-fenix` (v5.5)
6. **AI тексты:** `google/gemini-3.1-flash-lite-preview` через OpenRouter
7. **Структура песни:** [Куплет1][Припев][Куплет2][Бридж][Припев][Финал], макс 100 слов
8. **Chromium на мини ПК:** DISPLAY=:10.0, user sonar, нужен --load-extension и --remote-debugging-port=9222
9. **Robokassa:** merchant `podaripesniu`, PAYWALL_ENABLED=false (пока выключена)

## Языки и стек
- Node.js 22, grammY 1.30, undici, ws
- Next.js (suno-api)
- OpenRouter API (Gemini)
- Robokassa (подготовлена)
- Cloudflare Tunnel + DNS

## Не делать
- Не запускать в Docker
- Не обещать "всё работает, дыр нет"
- Не говорить "2 минуты" если процесс занимает часы
- Не показывать пользователям "SUNO" в ошибках
- Не деплоить без проверки
