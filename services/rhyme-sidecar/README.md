# rhyme-sidecar

Python FastAPI сайдкар — детерминированный детектор рифм на русском для бота «Подари Песню!».

## Зачем

Критик Sonnet 4.6 субъективно оценивает `rhyme_quality` и пропускает fake rhymes (всё/по-своему, глаза/тебя, привет/ответ). Сайдкар делает классификацию детерминированной через фонетический анализ со словарём ударений.

## API

```
POST /detect
Content-Type: application/json
{ "lyrics": "[Куплет 1]\n...строки текста..." }

→ 200 OK
{
  "rhymes": {
    "true":        [["путь", "свернуть"], ...],
    "approximate": [["готово", "корона"], ...],
    "fake":        [["всё", "по-своему"], ["глаза", "тебя"]]
  },
  "stats": {
    "lines": 24,
    "pairs_checked": 38,
    "model_loaded": true,
    "elapsed_ms": 340
  }
}

GET /health → { "ok": true, "model_loaded": bool }
```

**Нет поля `banale`** — BANALE-кластеры живут на Node-стороне (`src/ai/metrics.js#BANNED_RHYME_CLUSTERS`).

## Установка (Debian 13, 192.168.0.128)

```bash
sudo apt install -y python3.11 python3.11-venv
mkdir -p /home/alexander/projects/rhyme-sidecar
cd /home/alexander/projects/rhyme-sidecar
# залить сюда содержимое services/rhyme-sidecar/ (rsync/git clone)

python3.11 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# прогрев: первый запуск скачает модели ruaccent в ~/.cache/huggingface
./venv/bin/python -c "from ruaccent import RUAccent; a=RUAccent(); a.load(omograph_model_size='small_poetry', use_dictionary=True); print(a.process_all('тест строки'))"

# юнит-тесты (не требуют ruaccent)
./venv/bin/pytest tests/ -v

sudo cp rhyme-sidecar.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rhyme-sidecar
sudo systemctl status rhyme-sidecar --no-pager

# смоук
curl -s http://127.0.0.1:3100/health
curl -s -X POST http://127.0.0.1:3100/detect \
  -H 'content-type: application/json' \
  -d '{"lyrics":"[Куплет 1]\nя смотрю в её глаза\nи шепчу люблю тебя"}' | python3 -m json.tool
```

Ожидаем что curl выше вернёт `"fake": [["глаза","тебя"]]` — это sanity-check что классификатор живой.

## Классификация

1. **Извлечение ударения** — RUAccent ставит `+` перед ударной гласной.
2. **Рифменный хвост** = ударная гласная + всё после неё.
3. **Фонетическая нормализация**:
   - оглушение финальных согласных (`в→ф`, `б→п`, `д→т`, `г→к`, `з→с`, `ж→ш`)
   - стрип `ъ`, сохранение `ь`
4. **Классификация**:
   - ударные гласные различаются → **FAKE**
   - хвосты идентичны после нормализации → **TRUE**
   - ударная совпадает, хвосты различаются → **APPROXIMATE**
   - ударение не определено → **FAKE** (консервативно)

Орфографическое сравнение (а≠я, о≠ё, е≠э) — намеренно. Матчит продуктовую конвенцию:
пользователь и критик считают «глаза/тебя» не рифмой.

## Graceful degradation

Если `ruaccent` не установлен или не грузится — сайдкар поднимается с pass-through
функцией ударения. Endpoint `/detect` всё ещё отвечает, но классифицирует большинство
пар как FAKE (find_stress_index = -1). Node-сторона (`src/ai/rhymes.js`) уже готова к
пустому ответу и fallback'ится на старое поведение критика.

## Пары

Для строки `i` проверяем пары `(i, i+1)` и `(i, i+2)` — покрывает AABB, ABAB, ABBA, AABA.
Дедупликация по sorted tuple. Одинаковые слова skipped.

## Тесты

```bash
./venv/bin/pytest tests/ -v
```

Тесты используют хэндкрафченные строки с `+` маркерами — не требуют загрузки модели.
Покрытие: stress extraction, tail normalization, classify_pair, extractor, end-to-end.
