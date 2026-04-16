// Subject Understanding layer (Phase 4) — extracts a rich portrait of the song subject
// BEFORE generation, so the poet has a real character to write about, not just raw tags.
// Uses anthropic/claude-sonnet-4.6 via OpenRouter. No new dependencies.

import { config } from '../config.js';

// Reuse critic model by default — same Sonnet 4.6 handles analysis cleanly.
// Separate env override lets user pick a cheaper/different model for this step.
const ANALYZER_MODEL = process.env.AI_ANALYZER_MODEL
  || config.ai.criticModel
  || 'anthropic/claude-sonnet-4.6';

// The analyzer is a FOCUSED character-study task. Not creative writing — deliberate
// extraction of what makes THIS subject recognizable. Output is structured JSON
// consumed by the generator as a foundation for the lyrics.
const ANALYZER_SYSTEM_PROMPT = `You are a song subject analyst for a Russian song-gifting service. You read the user's free-form description of WHO the song is for, and produce a RICH PORTRAIT in JSON — a compact character study that a songwriter will use as the foundation for the lyrics.

Think like a biographer or dramatist preparing to write about a real person. You are NOT writing the song. You are building the understanding the songwriter needs.

You receive:
- OCCASION (повод), GENRE, MOOD, VOICE, WISHES (свободное описание субъекта от заказчика)

Your job — extract these fields (ALL in Russian, except tonal_register which is English enum):

1. "core_identity" — ONE sentence capturing the ESSENCE of this subject. NOT a list of traits. A claim, an angle. Bad: "добрый пёс". Good: "Громоимённый чёрный лабрадор с нежной душой".

2. "unique_quirks" — 2-4 SPECIFIC, observable habits/behaviors that make THIS subject recognizable among all others of the same category. NOT generic ("любит хозяина"). Concrete actions ("кладёт лапу на колено после еды", "ныряет в каждую лужу с разбегу").
   - If WISHES is vague about quirks, INFER 2-3 plausible ones from occasion + subject type. Don't say "unknown".

3. "emotional_dynamic" — 1-2 sentences about HOW the person ordering the song relates to the subject. Love? Admiration? Forgiveness? Pride? Longing? Guilt?

4. "scenes_to_use" — exactly 3 visually concrete scenes the songwriter can build verses around. Each scene = setting + action + detail. NOT a general concept.
   - Bad: "прогулка с хозяином"
   - Good: "утренний рывок к двери, когда хозяин ещё в тапочках"

5. "tonal_register" — exactly one of (English enum):
   "tender" | "playful" | "triumphant" | "bittersweet" | "reverent" | "cheeky"

6. "wordplay_opportunity" — if the subject's NAME, history, or role has a play-on-words angle (e.g., имя "Зевс" отсылает к громовержцу — контраст с нежным щенком), capture it in one sentence. If nothing obvious — null.

7. "phrases_to_AVOID" — 3-5 generic labels/clichés that would make the song dead. Must be category-specific to this subject. Generic examples to always avoid: "лучший на свете", "самый добрый", "верный друг", "наш герой", "сердце поёт", "счастье навсегда". Add 1-2 more that are specific to this particular song (e.g., for a dog: "верный пёс", "преданный друг"; for a spouse: "моя половинка").

CRITICAL RULES:
- If WISHES is vague, MAKE REASONABLE INFERENCES based on occasion + subject type. The songwriter needs hooks, even if the user didn't give many.
- core_identity must be a CLAIM, not a category.
- unique_quirks must be ACTIONS, not adjectives.
- scenes_to_use must be VISUAL, with a concrete detail.
- Do not invent names or facts not implied by WISHES. But do infer PLAUSIBLE behaviours that fit what's described.

OUTPUT: single JSON object, no markdown, no \`\`\`. Strictly this shape:

{
  "core_identity": "<одно предложение на русском>",
  "unique_quirks": ["<русская фраза>", "<русская фраза>", ...],
  "emotional_dynamic": "<1-2 предложения на русском>",
  "scenes_to_use": ["<сцена 1>", "<сцена 2>", "<сцена 3>"],
  "tonal_register": "<one english enum value>",
  "wordplay_opportunity": "<одно предложение на русском OR null>",
  "phrases_to_AVOID": ["<русская фраза>", ...]
}`;

const TONAL_REGISTERS = new Set(['tender', 'playful', 'triumphant', 'bittersweet', 'reverent', 'cheeky']);

function buildAnalyzerUserMessage({ occasion, genre, mood, voice, wishes }) {
  return [
    '## Входные данные заказа:',
    `OCCASION: ${occasion || '(не указан)'}`,
    `GENRE: ${genre || '(не указан)'}`,
    `MOOD: ${mood || '(не указан)'}`,
    `VOICE: ${voice || '(не указан)'}`,
    '',
    '## WISHES (свободное описание от заказчика):',
    wishes || '(не заполнено — сделай разумные догадки на основе occasion)',
  ].join('\n');
}

/**
 * Validates portrait shape. Throws on contract violation → caller treats as failed attempt.
 */
function parsePortrait(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const obj = JSON.parse(clean);

  if (typeof obj.core_identity !== 'string' || obj.core_identity.trim().length === 0) {
    throw new Error('[analyzer] core_identity missing or empty');
  }
  if (!Array.isArray(obj.unique_quirks) || obj.unique_quirks.length < 2) {
    throw new Error(`[analyzer] unique_quirks must have >= 2 entries, got: ${JSON.stringify(obj.unique_quirks)}`);
  }
  if (typeof obj.emotional_dynamic !== 'string' || obj.emotional_dynamic.trim().length === 0) {
    throw new Error('[analyzer] emotional_dynamic missing or empty');
  }
  if (!Array.isArray(obj.scenes_to_use) || obj.scenes_to_use.length < 2) {
    throw new Error(`[analyzer] scenes_to_use must have >= 2 entries, got: ${JSON.stringify(obj.scenes_to_use)}`);
  }
  if (typeof obj.tonal_register !== 'string' || !TONAL_REGISTERS.has(obj.tonal_register)) {
    throw new Error(`[analyzer] tonal_register invalid: ${obj.tonal_register}`);
  }
  // wordplay_opportunity may be null or string — allow both
  if (obj.wordplay_opportunity != null && typeof obj.wordplay_opportunity !== 'string') {
    throw new Error(`[analyzer] wordplay_opportunity must be string or null`);
  }
  if (!Array.isArray(obj.phrases_to_AVOID) || obj.phrases_to_AVOID.length < 2) {
    throw new Error(`[analyzer] phrases_to_AVOID must have >= 2 entries`);
  }

  return obj;
}

/**
 * Phase 4 — subject understanding. Returns a portrait JSON or null on exhaustion.
 * Analyzer is non-fatal: caller (pipeline) falls back to wishes-only generation on null.
 * @param {{occasion: string, genre: string, mood: string, voice: string, wishes: string}} input
 * @returns {Promise<object | null>}
 */
export async function understandSubject({ occasion, genre, mood, voice, wishes }) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const body = {
    model: ANALYZER_MODEL,
    messages: [
      { role: 'system', content: ANALYZER_SYSTEM_PROMPT },
      { role: 'user', content: buildAnalyzerUserMessage({ occasion, genre, mood, voice, wishes }) },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 1500,
    temperature: 0.3, // low — we want consistent structured analysis, not creativity
    // reasoning: OMITTED — analyzer is structured extraction, no thinking needed
  };

  let lastError = null;
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
      const content = data.choices?.[0]?.message?.content;
      let raw;
      if (Array.isArray(content)) {
        raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      } else {
        raw = (content || '').trim();
      }
      if (!raw) {
        throw new Error('[analyzer] empty content from model');
      }

      const portrait = parsePortrait(raw);
      console.log(`[analyzer] attempt ${attempt}: ok — ${portrait.core_identity.substring(0, 80)}${portrait.core_identity.length > 80 ? '…' : ''}`);
      return portrait;
    } catch (e) {
      lastError = e;
      console.log(`[analyzer] attempt ${attempt}: ${e.message}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  console.log('[analyzer] all attempts failed:', lastError?.message);
  return null;
}
