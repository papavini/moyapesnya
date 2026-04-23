// Rewrites a song draft given a structured critique from critic.js.
// Model: config.ai.rewriterModel (default anthropic/claude-sonnet-4.6 — see src/config.js).
// History:
//  - Originally google/gemini-2.5-flash; switched to Sonnet 4.6 in 34f4f27 because Flash
//    echoed the draft (~1.3% novelty).
//  - Commit 1015847 убрал extended thinking (cost ~$0.11 → ~$0.03). Результат — Герыч v2
//    (23.04 19:11): 7s latency, но 12.4% new tokens → rejected by sycophancy guard 15%
//    → pipeline отдал original draft с 37 fake rhymes. Rewriter без thinking стал ленив.
//  - Текущий коммит: thinking обратно ON, но с budget 3000 (было 8000) — компромисс
//    качество/цена (~$0.06 вместо $0.11). Sonnet требует temperature=1.0 при reasoning.
// Quality guards: explicit rewrite_instructions from critic, KEEP guard, newTokenRatio>=15%.
// Returns {lyrics} on success, null on failure or exhausted retries.
// Zero new dependencies.

import { config } from '../config.js';

const REWRITER_MODEL = config.ai.rewriterModel || 'anthropic/claude-sonnet-4.6';

// Word-boundary check — replaces naive `text.includes(word)` which gave
// false positives like 'нос' matching 'носит' or 'кот' matching 'который'.
// Mirror copy of pipeline.js#hasWordMatch — keep these in sync.
function hasWordMatch(text, word) {
  if (!text || !word) return false;
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z])${escaped}(?:[^а-яёА-ЯЁa-zA-Z]|$)`, 'i');
  return re.test(text);
}

// Dimensions the rewriter may fix (score 0-1 in critique)
const DIMS = ['story_specificity', 'chorus_identity', 'rhyme_quality', 'singability', 'emotional_honesty'];

// CRITICAL: KEEP instruction appears at TOP and BOTTOM — instruction drift guard.
// See STATE.md: "hard constraints at top and bottom of rewriter prompt".
const REWRITER_SYSTEM_PROMPT = `Ты переписываешь текст русской песни на основе структурированной критики.
Твоя задача: исправить ТОЛЬКО слабые разделы (оценка 0-1) согласно rewrite_instructions.
Сохрани сильные разделы ТОЧНО КАК НАПИСАНО — дословно, символ за символом.

══ ОГРАНИЧЕНИЯ (применять ВСЕГДА) ══

ФОРМАТ ВЫВОДА (обязательно):
Отвечай СТРОГО в JSON (без markdown, без \`\`\`, только чистый JSON):
{"lyrics": "переписанный текст песни здесь"}

СТРУКТУРА: Сохрани все заголовки разделов: [Куплет 1], [Припев], [Куплет 2], [Бридж], [Финал]
СЛОГИ: Строки под [Припев] — НЕ более 12 слогов каждая.
РИФМЫ: Избегай банальных пар из критики.

══ КАК ПЕРЕПИСЫВАТЬ ══

1. Для каждого раздела из keep_sections: воспроизведи его СИМВОЛ ЗА СИМВОЛОМ. Не улучшай.
   Не добавляй слова, не меняй рифмы, не перефразируй "немного лучше". ДОСЛОВНО.

2. Для разделов НЕ в keep_sections с оценкой 0-1: применяй rewrite_instructions.
   Каждая инструкция цитирует конкретную слабую строку — используй её как цель.
   Сохрани персонажей, имена, место действия и эмоциональную дугу песни.

3. Переписанная песня должна ощущаться как единое целое, не как лоскутное одеяло.
   Сглаживай переходы между сохранёнными и переписанными разделами, если нужно —
   но НЕ переписывай сохранённые разделы ради этого.

══ ОГРАНИЧЕНИЯ ПОВТОРЯЮТСЯ (защита от смещения инструкций) ══

ФОРМАТ ВЫВОДА: {"lyrics": "..."} только. Без markdown.
Разделы KEEP: воспроизведи дословно. Улучшения запрещены.
ПРИПЕВ: не более 12 слогов в строке.`;

/**
 * Estimates token count for Russian/mixed text. 1 word ≈ 1.3 tokens.
 * @param {string} text
 * @returns {number}
 */
function estimateTokenCount(text) {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Builds compressed critique as bullet points (used when context > 4000 tokens).
 * @param {object} critique
 * @returns {string}
 */
function buildCompressedCritique(critique) {
  return DIMS.map(dim => {
    const { score, rewrite_instructions } = critique[dim] || {};
    const status = score <= 1 ? `FIX (score=${score})` : `KEEP (score=${score})`;
    const instruction = score <= 1 && rewrite_instructions ? ` — ${rewrite_instructions}` : '';
    return `- ${dim}: ${status}${instruction}`;
  }).join('\n');
}

/**
 * Builds the user message: optional portrait + KEEP list + critique + original draft.
 * Compresses critique to bullets if combined context exceeds 4000 estimated tokens.
 * @param {string} lyrics
 * @param {object} critique
 * @param {object|null} portrait - optional Step U output (analyzer.js). Anchors the rewrite
 *   to the same character so it doesn't drift into a generic song while fixing weak sections.
 * @returns {string}
 */
function buildRewriterUserMessage(lyrics, critique, portrait) {
  const critiqueText = JSON.stringify(critique, null, 2);
  const portraitText = portrait ? JSON.stringify(portrait, null, 2) : '';
  const totalEstimate =
    estimateTokenCount(lyrics) + estimateTokenCount(critiqueText) + estimateTokenCount(portraitText);

  const critiqueSection = totalEstimate > 4000
    ? buildCompressedCritique(critique)
    : '```json\n' + critiqueText + '\n```';

  const sections = [];

  if (portrait) {
    sections.push(
      '## ПОРТРЕТ СУБЪЕКТА (сохрани этот характер при переписи — не размывай его в общие фразы):',
      '```json',
      portraitText,
      '```',
      ''
    );

    // GROUNDING — same enforcement as in critic.js. If the draft missed category nouns,
    // the rewrite MUST add at least one. This is the hard guarantee that prevents
    // "perfect wordplay, listener can't tell what species" failures.
    const categoryNouns = Array.isArray(portrait.subject_category_nouns)
      ? portrait.subject_category_nouns.filter(n => typeof n === 'string' && n.trim().length)
      : [];
    if (categoryNouns.length) {
      const missingAll = !categoryNouns.some(n => hasWordMatch(lyrics, n));
      sections.push(
        '## ОБЯЗАТЕЛЬНЫЕ СЛОВА (заземляют слушателя — без них непонятно про КОГО песня):',
        `В финальном тексте ОБЯЗАТЕЛЬНО должно прозвучать ХОТЯ БЫ ОДНО из: ${categoryNouns.map(n => `«${n}»`).join(', ')}`,
        missingAll
          ? '⚠️ В оригинальном черновике НИ ОДНО из этих слов НЕ встречается — это критическая ошибка заземления. Обязательно вставь одно из них в [Куплет 1] при переписи. Это НЕ нарушение KEEP — это исправление пропущенного.'
          : 'В черновике уже есть нужное слово — сохрани его при переписи.',
        ''
      );
    }
  }

  sections.push(
    '## РАЗДЕЛЫ KEEP (воспроизведи дословно, символ за символом):',
    (critique.keep_sections || []).join(', ') || '(нет)',
    '',
    '## КРИТИКА (исправь разделы с оценкой 0-1):',
    critiqueSection,
    '',
    '## ОРИГИНАЛЬНЫЙ ЧЕРНОВИК:',
    lyrics
  );

  return sections.join('\n');
}

/**
 * Rewrites lyrics based on a critique from critiqueDraft().
 * @param {string} lyrics - original song draft
 * @param {object} critique - output of critiqueDraft() from src/ai/critic.js
 * @param {object|null} [portrait] - optional Step U output. When provided, prepended to the
 *   user message so the rewriter preserves the same character study while fixing weak sections.
 * @returns {Promise<{lyrics: string} | null>}
 */
export async function rewriteDraft(lyrics, critique, portrait = null) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const body = {
    model: REWRITER_MODEL,
    messages: [
      { role: 'system', content: REWRITER_SYSTEM_PROMPT },
      { role: 'user', content: buildRewriterUserMessage(lyrics, critique, portrait) },
    ],
    // Thinking ON с уменьшенным budget (3000 вместо прежних 8000) — компромисс между
    // качеством и ценой. Без thinking rewriter стал ленивым: 7s latency, но 12.4% new
    // tokens — не проходил sycophancy guard 15% (Герыч 23.04 19:11). 3000 reasoning tokens
    // достаточно чтобы переписать weak секции на глубине, не просто косметически.
    // Claude с reasoning требует temperature=1.0.
    max_tokens: 12000,
    temperature: 1.0,
    reasoning: { max_tokens: 3000 },
    // response_format: OMIT — incompatible with reasoning ON via OpenRouter
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = JSON.parse(text);

      // Defensive content extraction — Gemini with thinking may return content as array
      // (same pattern as client.js lines 305-308)
      const content = data.choices?.[0]?.message?.content;
      let raw;
      if (Array.isArray(content)) {
        raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } else {
        raw = (content || '').trim();
      }

      if (!raw) throw new Error('[rewriter] пустой ответ от модели');

      // Strip markdown code fences if present (defensive — system prompt says no markdown)
      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean);
      const rewrittenLyrics = (parsed.lyrics || '').trim();
      if (!rewrittenLyrics) throw new Error('[rewriter] пустые lyrics в JSON');

      console.log(`[rewriter] attempt ${attempt}: ok, ${rewrittenLyrics.split('\n').length} lines`);
      return { lyrics: rewrittenLyrics };
    } catch (e) {
      console.log(`[rewriter] attempt ${attempt}: ${e.message}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.log('[rewriter] все попытки исчерпаны, возвращаем null');
  return null;
}
