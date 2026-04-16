# Requirements — AI Poet Pipeline

Generated: 2026-04-16

## v1 Requirements

### Pipeline

- [ ] **PIPELINE-01**: Система реализует последовательность generate→critique→rewrite в `src/ai/client.js`, сохраняя выходной формат `{lyrics, tags, title}`
- [ ] **PIPELINE-02**: Gate-логика пропускает critique+rewrite если черновик набирает ≥12/15 баллов по метрикам критика (fast path без лишних API-вызовов)
- [ ] **PIPELINE-03**: Critique-промпт оценивает черновик по 5 измерениям: Story Specificity, Chorus Identity, Rhyme Quality, Singability, Emotional Honesty — каждый 0-3 балла, итого макс 15
- [ ] **PIPELINE-04**: Rewrite-промпт получает оригинальный черновик + critique JSON и исправляет только секции со score 0-1, сохраняя сильные части

### Models

- [ ] **MODELS-01**: Generator и Rewriter используют `google/gemini-2.5-flash` с включённым thinking mode (verify: параметр `include_reasoning` через OpenRouter)
- [ ] **MODELS-02**: Critic использует `anthropic/claude-sonnet-4-6` (разная модель от генератора — исключает echo chamber и sycophancy)

### Metrics

- [x] **METRICS-01**: Детектор банальных рифм на JS — список ≥28 кластеров (любовь/кровь, розы/слёзы/морозы, ночь/прочь/дочь, ты/мечты/цветы и др.), результат передаётся в критика
- [x] **METRICS-02**: Счётчик слогов на JS (regex `[аеёиоуыэюя]`) — проверяет каждую строку припева на ≤12 слогов, передаёт нарушения в критика
- [ ] **METRICS-03**: LLM-judge для специфичности истории — отдельный вызов с вопросом «мог ли этот текст быть написан о любом другом человеке?», результат влияет на Story Specificity score
- [x] **METRICS-04**: Лексическое разнообразие — подсчёт уникальных слов / общее кол-во слов (MATTR-approx на JS), порог >0.60 для 200-словного текста

### Validation

- [ ] **VALID-01**: Набор 10-15 тестовых кейсов из реальных прошлых запросов (повод + детали + ожидаемый стиль) сохранён в `.planning/testcases/`
- [ ] **VALID-02**: Ручная A/B оценка: для каждого кейса — старый pipeline vs новый, слушаем и выбираем лучший. Протокол: ≥7/10 победа нового = deploy
- [ ] **VALID-03**: Калибровка порога gate (≥12/15) после первых 20-30 прогонов — скорректировать если >60% черновиков проходят без critique (порог слишком мягкий)

---

## v2 (Deferred)

- Python sidecar с `RussianPoetryScansionTool` для полного технического score рифм и ударений (требует Python окружение на сервере)
- A/B тест на реальных пользователях (требует PAYWALL_ENABLED + достаточная аудитория)
- Russian-native модели (GigaChat, YandexGPT) — нет на OpenRouter, требует отдельную интеграцию
- Автоматическое определение лучшей модели по накопленным данным

---

## Out of Scope

- Изменение SUNO интеграции — не связано с качеством текстов
- Изменение диалогового флоу бота — отдельная задача
- User-facing UI изменения — только backend pipeline
- BLEU/BERTScore метрики — не подходят без reference текстов
- Автоматический деплой на основе метрик без человеческого одобрения

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| METRICS-01 | Phase 1 | Complete |
| METRICS-02 | Phase 1 | Complete |
| METRICS-04 | Phase 1 | Complete |
| PIPELINE-03 | Phase 2 | Pending |
| MODELS-02 | Phase 2 | Pending |
| METRICS-03 | Phase 2 | Pending |
| PIPELINE-01 | Phase 3 | Pending |
| PIPELINE-02 | Phase 3 | Pending |
| PIPELINE-04 | Phase 3 | Pending |
| MODELS-01 | Phase 3 | Pending |
| VALID-01 | Phase 4 | Pending |
| VALID-02 | Phase 4 | Pending |
| VALID-03 | Phase 4 | Pending |
