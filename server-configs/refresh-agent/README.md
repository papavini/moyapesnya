# refresh-agent

HTTP сервис на мини-ПК (192.168.0.128 / tailnet 100.103.150.29) для удалённого
обновления SUNO авторизации. Бот, который живёт на Sber Cloud (`84.54.59.163`,
tailnet `100.126.47.92`), не имеет локального CDP/Chromium — поэтому он дёргает
этот сервис через Tailscale, чтобы освежить cookie или P1_ passkey.

Код агента: [`services/refresh-agent/index.js`](../../services/refresh-agent/index.js).
Импортирует `src/suno/refresh-cookie.js` и `src/suno/refresh-passkey.js` —
single source of truth, никакой логики refresh здесь не дублируется.

## Endpoints

| Method | Path                | Body                                  | Назначение |
|--------|---------------------|---------------------------------------|------------|
| GET    | `/health`           | —                                     | `{ok:true, busy, locked_by}` |
| POST   | `/refresh-cookie`   | —                                     | CDP `Network.getAllCookies` → 5 essential → `suno_cookie.txt` → `systemctl restart suno-api` |
| POST   | `/refresh-passkey`  | `{lyrics, tags, title}` (real data)   | CDP /create → 60s CF wait → fill form → click Create → intercept P1_ → POST на passkey-server :3099 |

`POST /refresh-passkey` ОБЯЗАН получать **реальные** данные пользователя в body —
иначе при click Create форма уйдёт с dummy lyrics, и SUNO потратит 10 кредитов
на мусорную песню.

Все refresh-операции сериализованы (CDP не любит concurrent сессии).

## Security

Биндится **только** на tailnet IP `100.103.150.29:3200` (`REFRESH_AGENT_HOST` env).
Недоступен из public internet и недоступен с LAN (`192.168.0.x`) — только
устройства в твоём tailnet (`podari-bot-cloud`) могут достучаться.

Если Tailscale упадёт, агент тоже не запустится (`After=tailscaled.service`),
а `EADDRNOTAVAIL` на старте даст fail-fast в логах.

## Установка (на мини-ПК)

```bash
wsl -d Ubuntu-20.04 -- ssh alexander@192.168.0.128
cd ~/projects/moyapesnya
git pull

sudo cp server-configs/refresh-agent/refresh-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now refresh-agent
sudo systemctl status refresh-agent --no-pager
```

### Sudoers (нужно для `refreshCookie()` → `systemctl restart suno-api`)

Если ещё не настроено (раньше `refresh-cookie.sh`-таймер работал — значит, скорее всего, уже есть):

```
alexander ALL=(ALL) NOPASSWD: /bin/systemctl restart suno-api, /usr/bin/systemctl restart suno-api
```

Положить в `/etc/sudoers.d/podari-refresh` через `visudo -f`.

## Тест

С самой мини-ПК:

```bash
curl -s http://100.103.150.29:3200/health
# {"ok":true,"busy":false,"locked_by":null}
```

С Sber Cloud (через tailnet):

```bash
wsl -d Ubuntu-20.04 -- ssh user1@84.54.59.163 'curl -s http://100.103.150.29:3200/health'
```

Полный сценарий cookie refresh:

```bash
curl -X POST http://100.103.150.29:3200/refresh-cookie
# {"ok":true}    — занимает ~5-15s (CDP + restart suno-api + ping)
```

Полный сценарий passkey refresh (реальные fills):

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"lyrics":"...текст песни...","tags":"pop upbeat","title":"Test"}' \
  http://100.103.150.29:3200/refresh-passkey
# {"ok":true}    — занимает 60-300s (CF Turnstile + fill + intercept)
```

## Логи

```bash
journalctl -u refresh-agent -f
journalctl -u refresh-agent --since '10 min ago'
```

## Откатить

```bash
sudo systemctl disable --now refresh-agent
sudo rm /etc/systemd/system/refresh-agent.service
sudo systemctl daemon-reload
```

Бот продолжит работать на мини-ПК через локальный CDP, если в его `.env`
отсутствует `REFRESH_AGENT_URL` (см. правки `src/suno/client.js` в Step 2 миграции).
