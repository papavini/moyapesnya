// Синхронный gate-модуль для оценки качества черновика текста песни.
// Три метрики: банальные рифмы (lookup по кластерам), слоговые нарушения (regex по гласным),
// лексическое разнообразие (MATTR-approx, скользящее окно 50 токенов).
// Нет зависимостей, нет I/O, нет API-вызовов. Чистая функция.

// === SKELETON ONLY ===
// Реализация метрик переносится в Plan 02. Этот файл существует, чтобы
// тесты в src/ai/metrics.test.js могли импортировать scoreDraft и запускаться (RED state TDD).

/**
 * Оценивает черновик текста песни по трём метрикам качества.
 * Синхронная функция, без I/O, без зависимостей.
 *
 * @param {string} lyrics - полный текст с секциями [Куплет 1], [Припев], [Куплет 2], [Бридж], [Финал]
 * @returns {{ banale_pairs: string[][], syllable_violations: Array<{line: string, count: number, max: number}>, lexical_diversity: number, skip_pipeline: boolean }}
 */
export function scoreDraft(lyrics) {
  // PLACEHOLDER — implementation lands in Plan 02 (METRICS-01, METRICS-02, METRICS-04 + gate).
  // Returning a shape-correct stub keeps imports working while tests stay RED.
  return {
    banale_pairs: [],
    syllable_violations: [],
    lexical_diversity: 0,
    skip_pipeline: false,
  };
}
