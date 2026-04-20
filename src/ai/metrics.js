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

// Sentence-initial words that look like proper nouns (start with capital) but are NOT.
// Used by extractProperNouns to skip false positives. Add as we observe new ones.
const SENTENCE_INITIAL_NON_NOUNS = new Set([
  'Я', 'Ты', 'Он', 'Она', 'Мы', 'Вы', 'Они', 'Это', 'Тот', 'Та', 'Те', 'Этот', 'Эта', 'Эти',
  'Когда', 'Если', 'Потом', 'Так', 'Тогда', 'Где', 'Кто', 'Что', 'Хотя', 'Также', 'Только',
  'Сейчас', 'Теперь', 'Часто', 'Никогда', 'Всегда', 'Иногда', 'Здесь', 'Там', 'Тут',
  'Желания', 'Желаний', 'Проложить', 'Купили', 'Пока', 'Дальше', 'Ещё', 'Уже',
  'Может', 'Должен', 'Будет', 'Был', 'Была', 'Были', 'Есть', 'Нет',
  'Сначала', 'Потому', 'Поэтому', 'Просто', 'Очень', 'Самый', 'Вот',
]);

// Word-boundary check — duplicate of pipeline.js#hasWordMatch / critic.js / rewriter.js.
// Kept here so metrics.js stays import-free (other consumers may load metrics standalone).
function hasWordMatch(text, word) {
  if (!text || !word) return false;
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z])${escaped}(?:[^а-яёА-ЯЁa-zA-Z]|$)`, 'i');
  return re.test(text);
}

/**
 * Извлекает proper nouns (имена, города, бренды) из свободного wishes-текста пользователя.
 * Эвристика: токен начинается с заглавной буквы (кириллица или латиница), длина >= 2,
 * и НЕ находится в начале предложения (чтобы не ловить «Когда», «Я», «Это» и т.д.).
 * Sentence-initial токены сравниваются со стоп-листом — если они там, пропускаем.
 *
 * False negatives возможны: имя в начале предложения «Зевс — наш пёс» не будет извлечено.
 * False positives возможны: незнакомые sentence-initial слова. Стоп-лист расширяется со временем.
 *
 * @param {string} text — свободный текст (wishes)
 * @returns {string[]} — уникальные proper nouns
 */
export function extractProperNouns(text) {
  if (!text || typeof text !== 'string') return [];
  const tokens = text.split(/\s+/);
  const nouns = new Set();

  for (let i = 0; i < tokens.length; i++) {
    // Strip surrounding punctuation
    const tok = tokens[i].replace(/^[.,!?;:—–\-«»"'()]+|[.,!?;:—–\-«»"'()]+$/g, '').trim();
    if (tok.length < 2) continue;

    // Must start with uppercase Cyrillic or Latin
    if (!/^[A-ZА-ЯЁ]/.test(tok)) continue;

    // Detect sentence-initial: prev token ends in .!? OR this is i=0
    const prevToken = i > 0 ? tokens[i - 1].trim() : '';
    const isSentenceStart = i === 0 || /[.!?]$/.test(prevToken);

    if (isSentenceStart) {
      // Sentence-initial: only count if NOT in known non-noun set
      if (SENTENCE_INITIAL_NON_NOUNS.has(tok)) continue;
      // Otherwise — could be a proper noun, but to be safe we still skip;
      // this trades false negatives for fewer false positives.
      continue;
    }

    nouns.add(tok);
  }

  return Array.from(nouns);
}

/**
 * Находит proper nouns из wishes, которые НЕ попали в финальный текст песни.
 * Используется как «lost-fact gate» — если пользователь упомянул «Yamaha», «Казань»
 * или имя адресата, и этих слов нет в lyrics — генератор провалил перевод входных
 * данных, и pipeline должен вызвать критика/rewriter, а не отдавать как есть.
 *
 * Word-boundary check, не substring (иначе «Нижний» матчил бы «нижний» в обычном слове).
 *
 * @param {string} wishes — исходный текст от пользователя
 * @param {string} lyrics — сгенерированный текст песни
 * @returns {string[]} — proper nouns, потерянные при генерации
 */
export function findLostFacts(wishes, lyrics) {
  const properNouns = extractProperNouns(wishes);
  if (properNouns.length === 0) return [];
  return properNouns.filter(n => !hasWordMatch(lyrics, n));
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
