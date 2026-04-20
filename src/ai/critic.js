// Two-call LLM critic: specificity judge (METRICS-03) + 5-dimension critique (PIPELINE-03).
// Uses anthropic/claude-sonnet-4.6 via OpenRouter. No new dependencies.
// Wave 2: real OpenRouter calls replace Wave 1 stubs.

import { config } from '../config.js';

// [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6 — dot notation, released 2026-02-17]
// Note: dot notation is OpenRouter namespace; Anthropic API uses hyphens (claude-sonnet-4-6).
// Hardcoded with optional env override via config.ai.criticModel.
const CRITIC_MODEL = process.env.AI_CRITIC_MODEL || config.ai.criticModel || 'anthropic/claude-sonnet-4.6';

// METRICS-03 micro-call prompt: two binary questions about the draft.
// Cheap (~50 output tokens). Result feeds the Story Specificity dimension.
const SPECIFICITY_JUDGE_PROMPT = (lyrics) => `You are a text analysis tool. Answer two questions about the song text below with YES or NO only.

Question 1: Does the text contain ANY proper nouns (personal names like "Рома", "Таня", "Лондон", "Арктика"; brand names; specific place names)? Note: line-initial capitalization in Russian poetry is NOT a proper noun signal — count only true names of people, places, and brands.

Question 2: Does the text contain ANY specific time expressions (years like "2019", relative times like "в пять утра", "три года назад", named seasons combined with a year, specific dates)?

Respond with EXACTLY this JSON (no other text, no code fences):
{"has_proper_nouns": true_or_false, "has_time_expressions": true_or_false}

SONG TEXT:
${lyrics}`;

// Word-boundary check — replaces naive `text.includes(word)` which gave
// false positives like 'нос' matching 'носит' or 'кот' matching 'который'.
// Mirror copy of pipeline.js#hasWordMatch — keep these in sync.
function hasWordMatch(text, word) {
  if (!text || !word) return false;
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z])${escaped}(?:[^а-яёА-ЯЁa-zA-Z]|$)`, 'i');
  return re.test(text);
}

// PIPELINE-03 — list of dimension keys, used by parser and total re-computation.
const DIMS = [
  'story_specificity',
  'chorus_identity',
  'rhyme_quality',
  'singability',
  'emotional_honesty',
];

// PIPELINE-03 — 5-dimension rubric system prompt. VERBATIM from RESEARCH.md Pattern 4.
const CRITIC_SYSTEM_PROMPT = `══ CRITICAL OUTPUT CONTRACT (read this FIRST and apply ALWAYS) ══

Your ENTIRE response must be a SINGLE JSON object starting with \`{\` and ending with \`}\`.
NO preamble. NO markdown. NO code fences. NO sentences like "I need to enumerate...",
"Let me first analyse...", "I'll go through each pair...", or ANY other thinking written
in the output. All your reasoning happens in the reasoning channel (extended thinking),
NEVER in the content channel.

THE FIRST CHARACTER OF YOUR REPLY MUST BE \`{\`. Anything else breaks the pipeline and
the song never reaches the user. This is non-negotiable.

If you catch yourself wanting to explain or enumerate something before answering —
STOP, do it internally only, then emit ONLY the JSON.

══ ROLE ══

You are a Russian song quality critic. Your job is to evaluate a song draft according
to exactly 5 dimensions and return a JSON critique. You do not write songs —
you evaluate them.

══ RUBRIC ══

Each dimension is scored 0-3:
  3 = Strong — no rewrite needed
  2 = Acceptable — minor weakness, acceptable in a fast pipeline
  1 = Weak — needs targeted rewrite
  0 = Failing — fundamental problem

DIMENSION 1: Story Specificity (0-3)
Measures: Does the song contain details that could only apply to THIS person? Not generic traits.
Indicators of HIGH score: proper nouns (names, places), specific objects, times, habits
Indicators of LOW score: abstract praise, could be about anyone, no concrete scenes
Grounding data provided: has_proper_nouns and has_time_expressions from LLM judge
Score 0-1 triggers: rewrite_instructions must quote a specific weak line from the draft.

DIMENSION 2: Chorus Identity (0-3)
Measures: Does the chorus capture ONE specific image or feeling that defines THIS person?
HIGH: a specific image, a catchphrase that fits only this person, ≤12 syllables per line
LOW: hobby list, generic praise ("он крутой"), could be sung at any birthday party
Grounding data: syllable_violations from Phase 1 metrics (chorus lines exceeding 12 syllables).
If syllable_violations is non-empty, Singability score is automatically penalized; Chorus Identity
score should separately evaluate identity quality.

DIMENSION 3: Rhyme Quality (0-3)
Measures: Are the rhymes real, fresh, and free of clichés?

═══ MANDATORY PROCEDURE — DO INTERNALLY, NEVER WRITE IN THE OUTPUT ═══
Before scoring, INTERNALLY enumerate every rhyme pair in the draft (verse couplets + chorus).
For EACH pair, INTERNALLY classify it as TRUE / APPROXIMATE / FAKE / BANALE using these rules.
The enumeration is your PRIVATE reasoning (extended thinking channel only) — DO NOT
write the pair-by-pair list in the JSON content. Only the final score and, when score ≤ 1,
rewrite_instructions appear in the output.

• TRUE rhyme  — last stressed vowel + everything after MATCHES.
  Examples: путь/свернуть, разгон/трон, луну/тишину, висок/ок.

• APPROXIMATE rhyme — last stressed vowel matches but tail consonants differ slightly.
  ACCEPTABLE in pop. Examples: готово/корона, лужи/нужно, кросс/слёз, нашей/Боже.

• FAKE rhyme — last stressed vowels DIFFER (different sound entirely) and/or
  the words have no common phonetic ending. NOT a rhyme at all.
  Concrete examples that MUST be caught as FAKE:
    ✗ «всё / по-своему»     (ё vs у — completely different vowels, no tail match)
    ✗ «глаза / тебя»        (А stressed vs Я stressed — different vowels)
    ✗ «всё / кино»          (ё vs о — different vowels)
    ✗ «железо / честно»     (классический пример fake)
    ✗ «дом / огонь»         (м vs нь — different consonants, no vowel match)
    ✗ «небо / время»        (е vs я — different stressed vowels)
    ✗ «любовь / навсегда»   (вь vs да — totally different endings)
    ✗ «душа / дорога»       (А vs О — different stressed vowels)

• BANALE rhyme — true/approximate but in the forbidden cliché list.
  Examples: любовь/кровь, розы/слёзы, ночи/очи, идёт/поёт (verb-only).

═══ SCORING LADDER (apply STRICTLY) ═══
  3 = ALL pairs TRUE or APPROXIMATE; at least one fresh / non-obvious pair.
  2 = ALL pairs TRUE or APPROXIMATE; no fresh standouts but no clichés or fakes.
  1 = EITHER 1 FAKE pair OR 1+ BANALE pair OR mostly verb-only rhymes.
  0 = 2+ FAKE pairs OR (1 FAKE + 1 BANALE) OR pervasive cliché stacking.

Grounding data: banale_pairs from Phase 1 metrics. If banale_pairs is non-empty,
score must be ≤ 1 AND rewrite_instructions MUST quote the banale pair(s) found.

If you find any FAKE pair, rewrite_instructions MUST list it in the format
«<word1> / <word2>» and demand it be replaced with a true rhyme on the same
stressed vowel.

DIMENSION 4: Singability (0-3)
Measures: Can each line be sung without awkward mouth gymnastics?
HIGH: 8-12 syllables, natural stress, no tongue twisters
LOW: >12 syllables in chorus, stacked consonant clusters, unnatural word order for singability
Grounding data: syllable_violations from Phase 1. If violations non-empty, score must be ≤ 1.

DIMENSION 5: Emotional Honesty (0-3)
Measures: Does the song SHOW emotion through scenes, not TELL it with adjectives?
HIGH: specific scenes that make listener feel the emotion, vulnerable moments, "show don't tell"
LOW: "он счастлив", "она сильная", "все его любят" — labels without images

══ OUTPUT FORMAT (final reminder — see also CRITICAL OUTPUT CONTRACT at the top) ══

Your reply MUST start with \`{\` — no preface, no thinking written out, no enumeration list.
All analysis is INTERNAL only. Output is ONLY the JSON object below.

Respond with a SINGLE JSON object matching this exact structure. No markdown, no code fences.
{
  "story_specificity": {"score": <0-3>, "rewrite_instructions": "<empty string if score>=2, else a specific instruction quoting a line from the draft>"},
  "chorus_identity":   {"score": <0-3>, "rewrite_instructions": "..."},
  "rhyme_quality":     {"score": <0-3>, "rewrite_instructions": "..."},
  "singability":       {"score": <0-3>, "rewrite_instructions": "..."},
  "emotional_honesty": {"score": <0-3>, "rewrite_instructions": "..."},
  "total": <sum of all 5 scores>,
  "keep_sections": [<list of section names like "[Куплет 1]" that score well — include AT LEAST 2 even in a weak draft, find the strongest sections>]
}

REMINDER: first character of your reply = \`{\`. Last character = \`}\`. Nothing before or after.`;

/**
 * Builds the critic user message: optional portrait + pre-computed metrics + the song draft.
 * RESEARCH.md Pattern 6 — metrics passed as "GROUNDING FACTS" the critic must not contradict.
 * When a portrait is provided (Step U output), the critic uses it as the BENCHMARK for
 * story_specificity and chorus_identity — does the draft actually capture this character?
 */
function buildCriticUserMessage(lyrics, metrics, specificity, portrait) {
  const groundingBlock = JSON.stringify({
    banale_pairs: metrics.banale_pairs,
    syllable_violations: (metrics.syllable_violations || []).map(v => v.line),
    lexical_diversity: metrics.lexical_diversity,
    has_proper_nouns: specificity.has_proper_nouns,
    has_time_expressions: specificity.has_time_expressions,
  }, null, 2);

  const sections = [];

  if (portrait) {
    sections.push(
      '## SUBJECT PORTRAIT (built by analyzer — the draft MUST capture this character; use as benchmark for story_specificity and chorus_identity):',
      '```json',
      JSON.stringify(portrait, null, 2),
      '```',
      ''
    );

    // GROUNDING CHECK — deterministic enforcement of subject_category_nouns.
    // If the lyrics contain NONE of these nouns (case-insensitive), the listener
    // cannot identify the subject's category — that's a story_specificity failure
    // regardless of how rich the wordplay or scenes are. We pre-compute the answer
    // here and tell the critic the exact verdict so it can't waffle.
    const categoryNouns = Array.isArray(portrait.subject_category_nouns)
      ? portrait.subject_category_nouns.filter(n => typeof n === 'string' && n.trim().length)
      : [];
    if (categoryNouns.length) {
      const present = categoryNouns.filter(n => hasWordMatch(lyrics, n));
      const missing = categoryNouns.filter(n => !hasWordMatch(lyrics, n));
      sections.push(
        '## GROUNDING CHECK (pre-computed — DO NOT contradict):',
        `Subject category nouns from portrait: ${categoryNouns.map(n => `«${n}»`).join(', ')}`,
        `Found in draft: ${present.length ? present.map(n => `«${n}»`).join(', ') : '(NONE)'}`,
        `Missing: ${missing.length ? missing.map(n => `«${n}»`).join(', ') : '(none missing)'}`,
        present.length === 0
          ? 'VERDICT: GROUNDING FAIL — the listener cannot identify the subject\'s category. You MUST set story_specificity.score = 0 and write rewrite_instructions that REQUIRE inserting at least one of the missing nouns into [Куплет 1].'
          : 'VERDICT: GROUNDING OK — at least one category noun appears in the draft. Score story_specificity normally on the other criteria.',
        ''
      );
    }
  }

  // Lost-fact verdict: proper nouns from user wishes that the generator dropped.
  // Pre-computed in client.js (findLostFacts). Critic must penalize story_specificity
  // and produce explicit rewrite_instructions to insert these names back.
  const lostFacts = Array.isArray(metrics?.lost_facts) ? metrics.lost_facts : [];
  if (lostFacts.length) {
    sections.push(
      '## LOST FACTS (proper nouns from user wishes that did NOT make it into lyrics — DO NOT contradict):',
      `Missing: ${lostFacts.map(f => `«${f}»`).join(', ')}`,
      'VERDICT: story_specificity.score MUST be ≤ 1. rewrite_instructions for story_specificity',
      'MUST require inserting at least one of these proper nouns into the lyrics (preferably',
      'in [Куплет 1] or [Припев]). These are the user\'s actual words — losing them means',
      'the song no longer matches the order.',
      ''
    );
  }

  sections.push(
    '## Pre-computed metrics (treat as GROUNDING FACTS — do not contradict these):',
    '```json',
    groundingBlock,
    '```',
    '',
    '## Song draft to evaluate:',
    lyrics
  );

  return sections.join('\n');
}

/**
 * Parses the critique JSON returned by the model and validates it against the contract.
 * Throws on any contract violation — caller treats throw as a failed attempt.
 * Pitfall 2: re-computes total from dimension scores. Pitfall 3: requires non-empty
 * rewrite_instructions for any dimension with score <= 1. Pitfall 5: keep_sections.length >= 2.
 */
function parseCritique(raw) {
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const obj = JSON.parse(clean);

  for (const dim of DIMS) {
    if (typeof obj[dim]?.score !== 'number') {
      throw new Error(`[critic] missing or non-numeric score for ${dim}`);
    }
    const s = obj[dim].score;
    if (s < 0 || s > 3) {
      throw new Error(`[critic] score out of range for ${dim}: ${s}`);
    }
    if (s <= 1) {
      const ri = obj[dim].rewrite_instructions;
      if (typeof ri !== 'string' || ri.trim().length === 0) {
        throw new Error(`[critic] missing rewrite_instructions for weak dimension ${dim} (score=${s})`);
      }
    } else if (typeof obj[dim].rewrite_instructions !== 'string') {
      // Force string shape even when score >= 2 (allow empty string)
      obj[dim].rewrite_instructions = '';
    }
  }

  if (!Array.isArray(obj.keep_sections) || obj.keep_sections.length < 2) {
    throw new Error(`[critic] keep_sections must have >= 2 entries, got: ${JSON.stringify(obj.keep_sections)}`);
  }

  // Pitfall 2: re-compute total — never trust model arithmetic
  obj.total = DIMS.reduce((sum, dim) => sum + obj[dim].score, 0);

  return obj;
}

/**
 * METRICS-03 — separate micro-call: does the draft contain proper nouns and time expressions?
 * @param {string} lyrics
 * @returns {Promise<{has_proper_nouns: boolean, has_time_expressions: boolean}>}
 */
export async function judgeSpecificity(lyrics) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const body = {
    model: CRITIC_MODEL,
    messages: [
      { role: 'user', content: SPECIFICITY_JUDGE_PROMPT(lyrics) },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 100,
    temperature: 0,
    // reasoning: OMITTED — no thinking for the judge call (Pitfall 4)
  };

  let text, res;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      text = await res.text();
      if (res.ok) break;
      console.log(`[critic] judge attempt ${attempt}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`[critic] judge attempt ${attempt}: ${e.message}`);
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }

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
    throw new Error('[critic] judge returned empty content');
  }

  // Defensive markdown strip (model may add fences despite json_object mode)
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(clean);

  if (typeof parsed.has_proper_nouns !== 'boolean'
    || typeof parsed.has_time_expressions !== 'boolean') {
    throw new Error(`[critic] judge JSON shape invalid: ${clean.substring(0, 200)}`);
  }

  return {
    has_proper_nouns: parsed.has_proper_nouns,
    has_time_expressions: parsed.has_time_expressions,
  };
}

/**
 * PIPELINE-03 — 5-dimension critique. Caller passes Phase 1 metrics from scoreDraft().
 * Returns a critique JSON object, or null if both retry attempts fail.
 * @param {string} lyrics
 * @param {object} metrics - output of scoreDraft() from src/ai/metrics.js
 * @param {object|null} [portrait] - optional Step U output from analyzer.js. When provided,
 *   the critic uses it as the benchmark for story_specificity and chorus_identity.
 * @returns {Promise<null | object>}
 */
export async function critiqueDraft(lyrics, metrics, portrait = null) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  // 1. Specificity micro-call. Non-fatal: defaults applied on failure.
  let specificity = { has_proper_nouns: false, has_time_expressions: false };
  try {
    specificity = await judgeSpecificity(lyrics);
  } catch (e) {
    console.log('[critic] specificity judge failed, using defaults:', e.message);
  }

  const userMessage = buildCriticUserMessage(lyrics, metrics, specificity, portrait);

  const body = {
    model: CRITIC_MODEL,
    messages: [
      { role: 'system', content: CRITIC_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4000,  // raised 2000→4000: Герыч v1 (11:51:59) attempt 1 truncated at position 473 — JSON with 5 dims + long Russian rewrite_instructions + keep_sections needs more headroom; price unchanged (we pay for actual tokens, not the cap)
    temperature: 0.2,
    // reasoning: OMITTED — no thinking for critic (Pitfall 4)
  };

  // 2. Up to 2 attempts. parseCritique() throws on any contract violation → retry.
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
        throw new Error('[critic] empty content from model');
      }

      const critique = parseCritique(raw);
      // Compact dim line: ss=N ci=N rq=N si=N eh=N
      const dimLine = DIMS.map(d => {
        const short = d.split('_').map(p => p[0]).join('');
        return `${short}=${critique[d].score}`;
      }).join(' ');
      console.log(`[critic] attempt ${attempt}: ok total=${critique.total} dims: ${dimLine}`);
      console.log(`[critic] keep_sections: ${JSON.stringify(critique.keep_sections)}`);
      // Show rewrite_instructions for weak dims (score<=1) — first 200 chars each
      for (const d of DIMS) {
        if (critique[d].score <= 1) {
          const ri = critique[d].rewrite_instructions || '';
          console.log(`[critic] weak ${d} (${critique[d].score}): ${ri.substring(0, 200)}${ri.length > 200 ? '…' : ''}`);
        }
      }
      return critique;
    } catch (e) {
      lastError = e;
      console.log(`[critic] attempt ${attempt}: ${e.message}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  console.log('[critic] all attempts failed:', lastError?.message);
  return null;
}
