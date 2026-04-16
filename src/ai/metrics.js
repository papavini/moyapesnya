// Синхронный gate-модуль для оценки качества черновика текста песни.
// Три метрики: банальные рифмы (lookup по кластерам), слоговые нарушения (regex по гласным),
// лексическое разнообразие (MATTR-approx, скользящее окно 50 токенов).
// Нет зависимостей, нет I/O, нет API-вызовов. Чистая функция.

// Гласные буквы русского алфавита (ё/Ё явно указаны — [а-я] не включает ё в JS Unicode)
const RUSSIAN_VOWELS = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g;

// Граница слова: всё что не буква, не цифра (ё/Ё явно, иначе не попадает в [а-я] range)
const WORD_BOUNDARY = /[^а-яёА-ЯЁa-zA-Z0-9]+/;

// Максимум слогов в строке припева
const MAX_CHORUS_SYLLABLES = 12;

// Размер скользящего окна для MATTR
const MATTR_WINDOW = 50;

// Минимальный порог лексического разнообразия для пропуска пайплайна
const SKIP_PIPELINE_THRESHOLD = 0.60;

// Кластеры банальных рифм. Слова внутри кластера взаимно банальны при рифмовке.
// 37 кластерных групп — перекрывают наиболее частотные штампы русской поп-поэзии.
const BANNED_RHYME_CLUSTERS = [
  ['любовь', 'вновь', 'кровь'],
  ['глаз', 'алмаз', 'нас', 'сейчас', 'раз'],
  ['нет', 'ответ', 'свет', 'привет', 'лет', 'след', 'бед', 'побед', 'бред', 'поэт', 'вслед'],
  ['розы', 'морозы', 'мимозы', 'грёзы', 'слёзы'],
  ['тебе', 'судьбе', 'борьбе'],
  ['доля', 'воля', 'поля'],
  ['дело', 'тело', 'смело'],
  ['чувство', 'искусство'],
  ['ты', 'красоты', 'цветы', 'мечты', 'черты', 'пустоты'],
  ['ночь', 'дочь', 'прочь', 'помочь'],
  ['небеса', 'чудеса', 'краса', 'леса', 'полоса'],
  ['пути', 'идти', 'найти', 'прийти', 'уйти', 'лети'],
  ['да', 'вода', 'всегда', 'года', 'беда', 'города', 'тогда', 'никогда'],
  ['она', 'луна', 'вина', 'весна', 'страна', 'тишина', 'одна', 'сна'],
  ['шесть', 'есть', 'честь', 'месть'],
  ['отец', 'конец', 'венец', 'сердец'],
  ['зима', 'сама', 'тьма', 'дома'],
  ['мне', 'вдвойне', 'войне', 'стране', 'сне', 'весне', 'тишине'],
  ['душа', 'дыша'],
  ['сердце', 'дверце', 'деревце'],
  ['жить', 'любить', 'забыть'],
  ['рассвет', 'завет'],
  ['один', 'господин'],
  ['судьба', 'борьба'],
  ['берег', 'небо'],
  ['вечер', 'встречи'],
  ['река', 'облака', 'пока', 'слегка'],
  ['звезда', 'мечта', 'красота', 'уста'],
  ['день', 'тень'],
  ['боль', 'роль', 'контроль'],
  ['счастье', 'ненастье'],
  ['молчать', 'кричать', 'отвечать', 'начинать'],
  ['огонь', 'ладонь'],
  ['синий', 'отныне'],
  ['любя', 'тебя', 'себя'],
  ['слова', 'сова', 'трава'],
  ['миг', 'крик', 'лик'],
];

// Производная Map: слово → индекс кластера (для O(1) lookup)
const wordToCluster = new Map();
BANNED_RHYME_CLUSTERS.forEach((cluster, idx) => {
  cluster.forEach(word => wordToCluster.set(word, idx));
});

/**
 * Нормализует заголовок секции к каноническому ключу.
 * Case-insensitive prefix match.
 * @param {string} raw - содержимое скобок без пробелов
 * @returns {string}
 */
function normalizeSectionKey(raw) {
  const lower = raw.toLowerCase().trim();
  if (lower.startsWith('припев')) return 'Припев';
  if (lower.startsWith('куплет 1') || lower.startsWith('куплет1')) return 'Куплет 1';
  if (lower.startsWith('куплет 2') || lower.startsWith('куплет2')) return 'Куплет 2';
  if (lower.startsWith('бридж')) return 'Бридж';
  if (lower.startsWith('финал')) return 'Финал';
  return raw.trim();
}

/**
 * Разбивает текст на секции по заголовкам в квадратных скобках.
 * Повторяющиеся блоки [Припев] — сохраняем только первый.
 * @param {string} lyrics
 * @returns {Object.<string, string[]>}
 */
function parseSections(lyrics) {
  const sections = {};
  let currentKey = null;

  const lines = lyrics.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    const match = line.match(/^\[([^\]]+)\]/);
    if (match) {
      const key = normalizeSectionKey(match[1]);
      // Повторяющийся Припев: пропускаем — сохраняем только первый
      if (key in sections) {
        currentKey = null; // не пишем строки в уже существующую секцию
      } else {
        sections[key] = [];
        currentKey = key;
      }
    } else if (currentKey !== null) {
      sections[currentKey].push(line);
    }
  }

  return sections;
}

/**
 * Считает количество слогов в строке (количество гласных букв).
 * @param {string} line
 * @returns {number}
 */
function countSyllables(line) {
  return (line.match(RUSSIAN_VOWELS) || []).length;
}

/**
 * Находит строки припева с нарушением максимума слогов (> 12).
 * @param {Object.<string, string[]>} sections
 * @returns {Array<{line: string, count: number, max: number}>}
 */
function findChorusSyllableViolations(sections) {
  const chorusLines = sections['Припев'] || [];
  const violations = [];
  for (const line of chorusLines) {
    const count = countSyllables(line);
    if (count > MAX_CHORUS_SYLLABLES) {
      violations.push({ line, count, max: MAX_CHORUS_SYLLABLES });
    }
  }
  return violations;
}

/**
 * Извлекает последнее слово каждой строки (для детектора банальных рифм).
 * Обрезает хвостовую пунктуацию, приводит к нижнему регистру.
 * @param {string[]} lines
 * @returns {string[]}
 */
function extractLineFinalWords(lines) {
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const last = tokens[tokens.length - 1];
    // Обрезаем хвостовую пунктуацию
    const word = last.replace(/[.,!?;:—–\-]+$/, '').toLowerCase();
    if (word) result.push(word);
  }
  return result;
}

/**
 * Находит банальные рифменные пары во всех строках текста.
 * O(n^2) попарное сканирование с дедупликацией.
 * @param {Object.<string, string[]>} sections
 * @returns {string[][]}
 */
function findBanalePairs(sections) {
  const allLines = Object.values(sections).flat();
  const finalWords = extractLineFinalWords(allLines);

  const seen = new Set();
  const pairs = [];

  for (let i = 0; i < finalWords.length; i++) {
    for (let j = i + 1; j < finalWords.length; j++) {
      const w1 = finalWords[i];
      const w2 = finalWords[j];

      // Пропускаем одинаковые слова
      if (w1 === w2) continue;

      const idx1 = wordToCluster.get(w1);
      const idx2 = wordToCluster.get(w2);

      // Оба слова должны быть в одном кластере
      if (idx1 === undefined || idx2 === undefined) continue;
      if (idx1 !== idx2) continue;

      // Дедупликация: ключ по отсортированной паре
      const key = [w1, w2].sort().join('/');
      if (seen.has(key)) continue;

      seen.add(key);
      pairs.push([w1, w2]);
    }
  }

  return pairs;
}

/**
 * Токенизирует текст для вычисления лексического разнообразия.
 * Удаляет теги секций, разбивает на слова, фильтрует слова короче 2 символов.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')  // убираем теги секций [Куплет 1] и т.д.
    .split(WORD_BOUNDARY)
    .filter(w => w.length >= 2);
}

/**
 * Вычисляет MATTR-approx (Moving Average Type-Token Ratio).
 * При токенов < windowSize: возвращает обычный TTR как fallback.
 * @param {string[]} tokens
 * @param {number} windowSize
 * @returns {number}
 */
function computeMATTR(tokens, windowSize = MATTR_WINDOW) {
  const n = tokens.length;

  // TTR fallback: недостаточно токенов для скользящего окна
  if (n < windowSize) {
    const unique = new Set(tokens).size;
    return unique / n;
  }

  // Скользящее окно шаг 1
  const windowCount = n - windowSize + 1;
  let sum = 0;

  for (let i = 0; i < windowCount; i++) {
    const window = tokens.slice(i, i + windowSize);
    const unique = new Set(window).size;
    sum += unique / windowSize;
  }

  return sum / windowCount;
}

/**
 * Оценивает черновик текста песни по трём метрикам качества.
 * Синхронная функция, без I/O, без зависимостей.
 *
 * @param {string} lyrics - полный текст с секциями [Куплет 1], [Припев], [Куплет 2], [Бридж], [Финал]
 * @returns {{ banale_pairs: string[][], syllable_violations: Array<{line: string, count: number, max: number}>, lexical_diversity: number, skip_pipeline: boolean }}
 */
export function scoreDraft(lyrics) {
  const sections = parseSections(lyrics);
  const banalePairs = findBanalePairs(sections);
  const syllableViolations = findChorusSyllableViolations(sections);
  const tokens = tokenize(lyrics);
  const diversity = tokens.length > 0 ? computeMATTR(tokens) : 0;
  const skipPipeline = banalePairs.length === 0
    && syllableViolations.length === 0
    && diversity >= SKIP_PIPELINE_THRESHOLD;

  return {
    banale_pairs: banalePairs,
    syllable_violations: syllableViolations,
    lexical_diversity: Math.round(diversity * 1000) / 1000,
    skip_pipeline: skipPipeline,
  };
}
