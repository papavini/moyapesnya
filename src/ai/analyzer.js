// Subject Understanding layer (Phase 4) — extracts a rich portrait of the song subject
// BEFORE generation, so the poet has a real character to write about, not just raw tags.
// Default model: anthropic/claude-haiku-4.5 (cost-optimized, structured JSON extraction).
// Env override via AI_ANALYZER_MODEL. No new dependencies.

import { config } from '../config.js';

// Structured JSON extraction — no creative reasoning needed. Default is Haiku 4.5 via
// config.ai.analyzerModel (~4x cheaper than Sonnet 4.6). On Haiku failure the pipeline
// degrades gracefully (portrait=null → wishes-only generation) so cost/quality downside
// is contained.
const ANALYZER_MODEL = config.ai.analyzerModel
  || process.env.AI_ANALYZER_MODEL
  || 'anthropic/claude-haiku-4.5';

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

3. "subject_category_nouns" — 2-4 concrete Russian nouns that NAME WHAT THE SUBJECT IS. The listener must hear at least one of these to understand the subject's CATEGORY (dog vs man vs mother vs friend). Body parts and species words are PERFECT here.
   - For a dog: ["пёс", "лабрадор", "хвост", "лапа"]
   - For a husband: ["муж", "мужчина"]
   - For a mother: ["мама", "мать"]
   - For a friend: ["друг", "приятель", "товарищ"]
   - For a child: ["сын"/"дочь", "ребёнок"]
   - These are NOT clichés — these are the BARE NOUNS the song needs so the listener doesn't think "is this about a horse? a child? a man?".

4. "emotional_dynamic" — 1-2 sentences about HOW the person ordering the song relates to the subject. Love? Admiration? Forgiveness? Pride? Longing? Guilt?

5. "scenes_to_use" — exactly 3 visually concrete scenes the songwriter can build verses around. Each scene = setting + action + detail. NOT a general concept.
   - Bad: "прогулка с хозяином"
   - Good: "утренний рывок к двери, когда хозяин ещё в тапочках"

6. "tonal_register" — exactly one of (English enum):
   "tender" | "playful" | "triumphant" | "bittersweet" | "reverent" | "cheeky"

7. "wordplay_opportunity" — if the subject's NAME, history, or role has a play-on-words angle (e.g., имя "Зевс" отсылает к громовержцу — контраст с нежным щенком), capture it in one sentence. If nothing obvious — null.

8. "phrases_to_AVOID" — 3-5 generic CLICHÉ PHRASES (multi-word expressions, NEVER bare single nouns) that would make the song dead. CRITICAL: each entry must be 2+ words. NEVER list a bare category noun like "пёс" or "муж" alone — that would forbid the song from naming the subject. List the FULL cliché: "верный пёс" (not "пёс"), "моя половинка" (not "муж"), "лучший на свете" (not "лучший").
   - Generic examples to always avoid: "лучший на свете", "самый добрый", "верный друг", "наш герой", "сердце поёт", "счастье навсегда".
   - Category-specific: for a dog "верный пёс", "преданный друг"; for a spouse "моя половинка"; for a mom "мама-солнышко".

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
  "subject_category_nouns": ["<существительное>", "<существительное>", ...],
  "emotional_dynamic": "<1-2 предложения на русском>",
  "scenes_to_use": ["<сцена 1>", "<сцена 2>", "<сцена 3>"],
  "tonal_register": "<one english enum value>",
  "wordplay_opportunity": "<одно предложение на русском OR null>",
  "phrases_to_AVOID": ["<многословная фраза-клише>", "<многословная фраза-клише>", ...]
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
  if (!Array.isArray(obj.subject_category_nouns) || obj.subject_category_nouns.length < 1) {
    throw new Error(`[analyzer] subject_category_nouns must have >= 1 entry, got: ${JSON.stringify(obj.subject_category_nouns)}`);
  }
  // Each category noun must be a non-empty single token (no spaces) — defensive guard
  // against the model returning multi-word phrases here.
  for (const n of obj.subject_category_nouns) {
    if (typeof n !== 'string' || n.trim().length === 0) {
      throw new Error(`[analyzer] subject_category_nouns contains non-string or empty: ${JSON.stringify(n)}`);
    }
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
  // Defensive: drop any bare single-word entries — they would forbid the song from
  // naming the subject's category (e.g., a bare "пёс" in avoid-list made the generator
  // refuse to ever say "пёс", losing subject category for the listener).
  // Also drop any entry that is exactly one of subject_category_nouns.
  const categorySet = new Set(obj.subject_category_nouns.map(n => n.toLowerCase().trim()));
  obj.phrases_to_AVOID = obj.phrases_to_AVOID.filter(p => {
    if (typeof p !== 'string') return false;
    const trimmed = p.trim();
    if (trimmed.length === 0) return false;
    // Drop bare single-word entries (no spaces)
    if (!trimmed.includes(' ')) return false;
    // Drop entries that exactly match a category noun
    if (categorySet.has(trimmed.toLowerCase())) return false;
    return true;
  });

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
