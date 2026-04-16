// Rewrites a song draft given a structured critique from critic.js.
// Uses google/gemini-2.5-flash with thinking mode ON (reasoning.max_tokens = 8000).
// Returns {lyrics} on success, null on failure or exhausted retries.
// Zero new dependencies.

import { config } from '../config.js';

const REWRITER_MODEL = config.ai.rewriterModel || 'google/gemini-2.5-flash';

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
 * Builds the user message: KEEP list + critique + original draft.
 * Compresses critique to bullets if combined context exceeds 4000 estimated tokens.
 * @param {string} lyrics
 * @param {object} critique
 * @returns {string}
 */
function buildRewriterUserMessage(lyrics, critique) {
  const critiqueText = JSON.stringify(critique, null, 2);
  const totalEstimate = estimateTokenCount(lyrics) + estimateTokenCount(critiqueText);

  const critiqueSection = totalEstimate > 4000
    ? buildCompressedCritique(critique)
    : '```json\n' + critiqueText + '\n```';

  return [
    '## РАЗДЕЛЫ KEEP (воспроизведи дословно, символ за символом):',
    (critique.keep_sections || []).join(', ') || '(нет)',
    '',
    '## КРИТИКА (исправь разделы с оценкой 0-1):',
    critiqueSection,
    '',
    '## ОРИГИНАЛЬНЫЙ ЧЕРНОВИК:',
    lyrics,
  ].join('\n');
}

/**
 * Rewrites lyrics based on a critique from critiqueDraft().
 * @param {string} lyrics - original song draft
 * @param {object} critique - output of critiqueDraft() from src/ai/critic.js
 * @returns {Promise<{lyrics: string} | null>}
 */
export async function rewriteDraft(lyrics, critique) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const body = {
    model: REWRITER_MODEL,
    messages: [
      { role: 'system', content: REWRITER_SYSTEM_PROMPT },
      { role: 'user', content: buildRewriterUserMessage(lyrics, critique) },
    ],
    max_tokens: 16000,
    // Claude with extended thinking REQUIRES temperature=1.0; Gemini Flash also tolerates it.
    temperature: 1.0,
    reasoning: { max_tokens: 8000 },
    // response_format: omit — incompatible with reasoning ON for Gemini and Claude via OpenRouter
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
