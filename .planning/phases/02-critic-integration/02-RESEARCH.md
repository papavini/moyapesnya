# Phase 2: Critic Integration — Research

**Researched:** 2026-04-16
**Domain:** LLM-as-judge evaluation, OpenRouter API, structured JSON output, Russian lyric specificity detection
**Confidence:** HIGH (stack) / MEDIUM (METRICS-03 prompt design)

---

## Summary

Phase 2 adds a `critiqueDraft(lyrics, metrics)` function in `src/ai/critic.js` that calls
Claude Sonnet 4.6 via OpenRouter and returns a structured JSON critique with 5-dimension scores,
`rewrite_instructions` for failing dimensions, and a `keep_sections` list. The critic receives
Phase 1 `scoreDraft()` output as grounding context — not to replace it, but to anchor its
evaluation with already-computed facts (banale pairs, syllable violations, lexical diversity).

METRICS-03 (LLM-judge specificity) is a **separate, cheap micro-call**: a 3-sentence prompt asking
Claude to answer two binary questions about the draft (proper nouns present? time expressions
present?). The result influences the Story Specificity score in the main critique call. This
separation keeps latency under control and makes each concern testable in isolation.

**Critical model ID finding:** The OpenRouter model ID is `anthropic/claude-sonnet-4.6` (dot, not
hyphen). The Anthropic API ID is `claude-sonnet-4-6` (hyphens only). Since the project routes
exclusively through OpenRouter, use the dot notation: `anthropic/claude-sonnet-4.6`. The current
`.env` default `anthropic/claude-sonnet-4-5` (old fallback) must be overridden by setting
`AI_CRITIC_MODEL=anthropic/claude-sonnet-4.6` in `.env`.

**Primary recommendation:** Implement critic in a new `src/ai/critic.js` module (not inside
`client.js`). Use `response_format: { type: 'json_object' }` + strict system prompt JSON enforcement
as the primary strategy; fall back to `json_schema` if `json_object` is not reliably enforced by
OpenRouter for the Anthropic provider. Keep thinking/reasoning OFF for the critic call — it adds
latency and cost without measurable benefit for a rubric-based evaluation task.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPELINE-03 | Critique prompt evaluates draft on 5 dimensions (Story Specificity, Chorus Identity, Rhyme Quality, Singability, Emotional Honesty), each 0-3, total max 15 | JSON schema for critique output defined in Architecture Patterns; critic prompt template in Code Examples |
| MODELS-02 | Critic uses `anthropic/claude-sonnet-4.6` (different provider from generator breaks echo chamber) | Model ID verified: OpenRouter ID is `anthropic/claude-sonnet-4.6` [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6] |
| METRICS-03 | LLM-judge for story specificity — separate call, result feeds Story Specificity score | Separate micro-call pattern specified; prompt template in Code Examples; integration into critique score documented |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Critique call (5 dimensions) | Node.js module (src/ai/critic.js) | — | New module, co-located with metrics.js and client.js; keeps critic concerns separate from generator |
| METRICS-03 specificity judge | Node.js module (src/ai/critic.js) | — | Thin wrapper around a second OpenRouter call; same module, separate exported function |
| JSON schema enforcement | OpenRouter `response_format` + system prompt | — | `json_object` mode + system prompt is primary; `json_schema` fallback if needed |
| Skip gate (>= 12/15) | src/ai/critic.js `critiqueDraft()` caller | — | Gate logic sits in the caller (Phase 3 orchestrator); critic.js always returns a critique, never short-circuits |
| Phase 1 metrics consumption | src/ai/critic.js | src/ai/metrics.js | Caller passes `metrics` from `scoreDraft()` output; critic.js does NOT re-run scoreDraft |
| Test fixtures | src/ai/critic.test.js | — | node:test, same framework as Phase 1 |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-in `fetch` | Node 22 | OpenRouter HTTP call | Already used in client.js line 1 comment; consistent with existing pattern |
| `node:test` | Built-in Node 22 | Unit test runner | Already in use for metrics.test.js; project has zero test deps |

### No New Dependencies

Phase 2 adds zero new npm packages. All needs are met by:
- Node built-in `fetch` (already used in `src/ai/client.js`)
- `src/config.js` for API key and base URL (already exists)
- `src/ai/metrics.js` `scoreDraft()` output as input data (already exists)

**Installation:** `npm install` — nothing to add.

**Version verification:** `npm view node` — Node 22 built-in fetch is stable. No registry check
needed. [VERIFIED: package.json engines >= 20, project already uses `fetch` in client.js]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| System prompt JSON enforcement | `json_schema` response_format | `json_schema` requires schema definition upfront; system prompt enforcement is simpler and tested to work reliably with Claude models that output structured data well. Both are available on OpenRouter. |
| Separate micro-call for METRICS-03 | Fold specificity into critic prompt | Folding adds complexity to the main prompt and makes it harder to test specificity judgment in isolation. Separate call is ~$0.0001 extra cost but gives clear testability. |
| `reasoning: { max_tokens: N }` ON | Reasoning OFF | Reasoning adds latency and cost ($3/MTok input, $15/MTok output, reasoning tokens counted separately). For a rubric-based scoring task the chain-of-thought benefit is low — Claude follows structured rubrics well without it. Keep OFF. |

---

## Architecture Patterns

### System Architecture Diagram

```
generateLyrics(input)       [src/ai/client.js — existing]
       |
       v
  [AI Generator call]  — returns draft {lyrics, tags, title, metrics}
       |
       v
    scoreDraft(lyrics)       [src/ai/metrics.js — Phase 1, already wired]
       |
       v
    metrics {banale_pairs, syllable_violations, lexical_diversity, skip_pipeline}
       |
       v
critiqueDraft(lyrics, metrics)  [src/ai/critic.js — NEW Phase 2]
       |
       +-- specificity_judge(lyrics)   micro-call to OpenRouter
       |          |
       |          v
       |    {has_proper_nouns, has_time_expressions}   feeds Story Specificity score
       |
       +-- critic_call(lyrics, metrics, specificity)   main 5-dimension call
                  |
                  v
          critique JSON {
            story_specificity: {score, rewrite_instructions},
            chorus_identity:   {score, rewrite_instructions},
            rhyme_quality:     {score, rewrite_instructions},
            singability:       {score, rewrite_instructions},
            emotional_honesty: {score, rewrite_instructions},
            total: number,
            keep_sections: string[]
          }
```

### Recommended Project Structure

```
src/
├── ai/
│   ├── client.js        # existing — generateLyrics() returns {lyrics, tags, title, metrics}
│   ├── metrics.js       # Phase 1 — scoreDraft() gate
│   └── critic.js        # NEW Phase 2 — critiqueDraft(lyrics, metrics)
└── ...

src/ai/
├── metrics.test.js      # Phase 1 tests (existing)
└── critic.test.js       # NEW Phase 2 — node:test unit tests
```

**Note on file location:** `critic.js` is placed in `src/ai/` alongside `client.js` and
`metrics.js`. It is NOT inside `client.js`. Phase 3 will import `critiqueDraft` from
`./critic.js` the same way `client.js` already imports `scoreDraft` from `./metrics.js`.

### Pattern 1: OpenRouter Call Structure (follow existing client.js pattern exactly)

**What:** How to call OpenRouter from Node.js — follow the exact same pattern already in
`src/ai/client.js`.

```js
// Source: src/ai/client.js (existing, verified in this session)
// Exact same headers + body structure — no deviation from established pattern

const CRITIC_MODEL = 'anthropic/claude-sonnet-4.6';
// [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6 — dot notation, released 2026-02-17]

const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.ai.apiKey}`,
  },
  body: JSON.stringify({
    model: CRITIC_MODEL,
    messages: [
      { role: 'system', content: CRITIC_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 2000,
    temperature: 0.2,      // low temp for consistent scoring
    // reasoning: NOT set — keep thinking OFF for critic (latency + cost)
  }),
});
```

**Key differences from generator call:**
- `model`: `anthropic/claude-sonnet-4.6` (not `config.ai.model` — critic always uses this model)
- `temperature: 0.2` (not 1.0 — scoring needs consistency, not creativity)
- `reasoning`: omitted entirely (thinking OFF for critic)
- `max_tokens: 2000` (critique JSON is ~500-800 tokens, 2000 gives headroom)

### Pattern 2: JSON Output Enforcement Strategy

**What:** How to reliably get JSON from Claude via OpenRouter.

OpenRouter supports two approaches for JSON:
1. `response_format: { type: 'json_object' }` — guarantees valid JSON syntax; no schema enforcement
2. `response_format: { type: 'json_schema', json_schema: {...} }` — strict schema enforcement; requires defining the full schema

**Recommended strategy for this project:**

Use `response_format: { type: 'json_object' }` combined with a system prompt that explicitly
defines the exact JSON structure expected. This is simpler to implement, produces the same
practical result with Claude (which follows instructions well), and avoids maintaining a
separate JSON Schema definition.

[VERIFIED: OpenRouter docs at openrouter.ai/docs/guides/features/structured-outputs confirm
both modes available; json_object works for all models that support JSON mode]

```js
body: JSON.stringify({
  model: CRITIC_MODEL,
  messages: [
    { role: 'system', content: CRITIC_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ],
  response_format: { type: 'json_object' },  // guarantees parseable JSON
  max_tokens: 2000,
  temperature: 0.2,
}),
```

**Fallback if `json_object` fails:** System prompt ends with:
```
Respond STRICTLY with a single JSON object. No markdown, no code fences, no explanation.
```
This mirrors the existing pattern in `client.js` line 237 (`Respond STRICTLY in JSON...`).

### Pattern 3: Critique JSON Schema (the output contract)

**What:** The exact JSON structure `critiqueDraft()` must return. This is the contract that
Phase 3 will consume.

```js
// Critique output contract — what critiqueDraft() returns
// All 5 dimensions required; scores 0-3; rewrite_instructions required when score <= 1
{
  "story_specificity": {
    "score": 2,
    "rewrite_instructions": ""   // empty string if score >= 2
  },
  "chorus_identity": {
    "score": 1,
    "rewrite_instructions": "Line 'ты мой герой, мой идеал' could be about anyone. Rewrite to capture one specific habit or image of this person."
  },
  "rhyme_quality": {
    "score": 2,
    "rewrite_instructions": ""
  },
  "singability": {
    "score": 3,
    "rewrite_instructions": ""
  },
  "emotional_honesty": {
    "score": 1,
    "rewrite_instructions": "Lines state emotion ('он счастлив') rather than showing a scene. Rewrite [Куплет 2] to show a specific moment."
  },
  "total": 9,
  "keep_sections": ["[Куплет 1]", "[Финал]"]
}
```

**Section names in `keep_sections`:** Use exact bracket notation matching the song structure:
`"[Куплет 1]"`, `"[Куплет 2]"`, `"[Припев]"`, `"[Бридж]"`, `"[Финал]"`.

**`total` field:** Must be the arithmetic sum of all 5 scores. Critic computes it in its output;
caller should re-verify (`story + chorus + rhyme + sing + emotional`) to guard against hallucination.

### Pattern 4: Critic System Prompt Structure

**What:** The system prompt template for the 5-dimension critic call.

```
CRITIC_SYSTEM_PROMPT:

You are a Russian song quality critic. Your job is to evaluate a song draft according to exactly 5 dimensions and return a JSON critique. You do not write songs — you evaluate them.

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
Measures: Are the rhymes fresh? No clichés?
HIGH: non-obvious rhymes, internal rhymes, varied scheme
LOW: banale pairs, verb-only rhymes (идёт/поёт), fake rhymes (железо/честно)
Grounding data: banale_pairs from Phase 1 metrics. If banale_pairs is non-empty, score must be ≤ 1.
Rhyme Quality rewrite_instructions MUST quote the banale pair(s) found.

DIMENSION 4: Singability (0-3)
Measures: Can each line be sung without awkward mouth gymnastics?
HIGH: 8-12 syllables, natural stress, no tongue twisters
LOW: >12 syllables in chorus, stacked consonant clusters, unnatural word order for singability
Grounding data: syllable_violations from Phase 1. If violations non-empty, score must be ≤ 1.

DIMENSION 5: Emotional Honesty (0-3)
Measures: Does the song SHOW emotion through scenes, not TELL it with adjectives?
HIGH: specific scenes that make listener feel the emotion, vulnerable moments, "show don't tell"
LOW: "он счастлив", "она сильная", "все его любят" — labels without images

══ OUTPUT FORMAT ══

Respond with a SINGLE JSON object matching this exact structure. No markdown, no code fences.
{
  "story_specificity": {"score": <0-3>, "rewrite_instructions": "<empty string if score>=2, else a specific instruction quoting a line from the draft>"},
  "chorus_identity":   {"score": <0-3>, "rewrite_instructions": "..."},
  "rhyme_quality":     {"score": <0-3>, "rewrite_instructions": "..."},
  "singability":       {"score": <0-3>, "rewrite_instructions": "..."},
  "emotional_honesty": {"score": <0-3>, "rewrite_instructions": "..."},
  "total": <sum of all 5 scores>,
  "keep_sections": [<list of section names like "[Куплет 1]" that score well — include at least 2>]
}
```

### Pattern 5: METRICS-03 Specificity Judge (separate micro-call)

**What:** A separate, cheap OpenRouter call that asks two binary questions about the draft. Returns
`{has_proper_nouns: boolean, has_time_expressions: boolean}`. The result is passed to the main
critic call as grounding context for the Story Specificity dimension.

**Why separate:** Makes it independently testable. The Phase 2 success criteria include: "a draft
with no proper nouns or time expressions scores lower than one with them." That's a test we can
write in isolation without running the full 5-dimension critique.

**Model for micro-call:** Same `anthropic/claude-sonnet-4.6` (or potentially cheaper model later).
**Latency impact:** ~500-800ms for a 3-sentence response. Acceptable given 150s budget.
**Cost:** Tiny — input ~300 tokens, output ~50 tokens = ~$0.0010/call.

```js
// Pattern: specificity_judge call
const SPECIFICITY_JUDGE_PROMPT = `
You are a text analysis tool. Answer two questions about the song text below with YES or NO only.

Question 1: Does the text contain ANY proper nouns (personal names like "Рома", "Таня", "Лондон",
"Арктика"; brand names; specific place names)?

Question 2: Does the text contain ANY specific time expressions (years like "2019", relative times
like "в пять утра", "три года назад", named seasons combined with a year, specific dates)?

Respond with EXACTLY this JSON (no other text):
{"has_proper_nouns": true/false, "has_time_expressions": true/false}

SONG TEXT:
${lyrics}
`.trim();

// Call structure: same fetch pattern, max_tokens: 100, temperature: 0
```

**Fixture examples for tests:**

```
BAD specificity (no proper nouns, no time): 
  "Он встаёт по утрам, он идёт на работу,
   Она ждёт его дома с горячим чаем."
  Expected: {has_proper_nouns: false, has_time_expressions: false}

GOOD specificity:
  "Рома шнурует кросс в шесть утра,
   Под фонарём в Митино, пока все спят."
  Expected: {has_proper_nouns: true, has_time_expressions: true}
```

### Pattern 6: Phase 1 Metrics as Grounding Data

**What:** How to pass `scoreDraft()` output into the critic prompt.

The critic receives the metrics as a compact JSON block in the user message (not the system
prompt). This keeps the system prompt stable and puts variable data in the user turn.

```js
// User message construction
function buildCriticUserMessage(lyrics, metrics, specificity) {
  const groundingBlock = JSON.stringify({
    banale_pairs: metrics.banale_pairs,           // from scoreDraft()
    syllable_violations: metrics.syllable_violations.map(v => v.line), // just the lines
    lexical_diversity: metrics.lexical_diversity,
    has_proper_nouns: specificity.has_proper_nouns,
    has_time_expressions: specificity.has_time_expressions,
  }, null, 2);

  return [
    '## Pre-computed metrics (treat as GROUNDING FACTS — do not contradict these):',
    '```json',
    groundingBlock,
    '```',
    '',
    '## Song draft to evaluate:',
    lyrics,
  ].join('\n');
}
```

**Why "grounding facts":** The critic prompt explicitly tells the model that `banale_pairs` and
`syllable_violations` are already-computed facts. This prevents the critic from giving a high
Rhyme Quality score when Phase 1 already found banale pairs. The critic might miss a banale
pair on its own; the JS detector is more reliable for the known cluster list.

### Pattern 7: Error Handling and Fallback

**What:** What to do if OpenRouter returns malformed JSON or an HTTP error.

```js
export async function critiqueDraft(lyrics, metrics) {
  // 1. Run specificity judge (separate call)
  let specificity = { has_proper_nouns: false, has_time_expressions: false };
  try {
    specificity = await judgeSpecificity(lyrics);
  } catch (e) {
    console.log('[critic] specificity judge failed, using defaults:', e.message);
    // Non-fatal: proceed with defaults
  }

  // 2. Run main critic call (up to 2 attempts)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await callCritic(lyrics, metrics, specificity);
      const critique = parseCritique(raw);
      // Verify total = sum of dimensions
      const expectedTotal = critique.story_specificity.score
        + critique.chorus_identity.score
        + critique.rhyme_quality.score
        + critique.singability.score
        + critique.emotional_honesty.score;
      if (critique.total !== expectedTotal) {
        critique.total = expectedTotal; // fix hallucinated total
      }
      return critique;
    } catch (e) {
      console.log(`[critic] attempt ${attempt}: ${e.message}`);
      if (attempt === 2) {
        // Return null — caller (Phase 3) proceeds with original draft
        return null;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}
```

**Null return contract:** When `critiqueDraft()` returns `null`, Phase 3 should treat it as
"skip pipeline" and return the original draft. This prevents a critic failure from blocking
song delivery.

### Anti-Patterns to Avoid

- **Reasoning ON for the critic:** The current `client.js` passes `reasoning: { max_tokens: 8000 }`.
  Do NOT copy this for the critic. Rubric-based scoring does not benefit from extended thinking.
  Claude 4.6 Sonnet supports adaptive thinking — if no `reasoning` parameter is passed, it
  defaults to no thinking (not adaptive thinking). Adaptive thinking only activates when `reasoning`
  is passed without `max_tokens`. Leave the parameter out entirely.
  [VERIFIED: openrouter.ai/docs/guides/best-practices/reasoning-tokens]

- **Using `config.ai.model` for critic:** The critic model is ALWAYS `anthropic/claude-sonnet-4.6`.
  It must NOT use the configurable `config.ai.model` (which points to the generator). Add a
  separate `AI_CRITIC_MODEL` env var or hardcode it as a constant in `critic.js`.

- **Re-running scoreDraft inside critic.js:** The caller passes `metrics` as a parameter.
  `critic.js` must NOT call `scoreDraft()` internally — that would double-compute metrics and
  break the single-responsibility principle.

- **Returning the full critique for a draft that passes Phase 1 skip_pipeline=true:** The skip
  gate decision belongs in Phase 3 (the orchestrator). `critiqueDraft()` always runs when called.
  The `skip_pipeline` field is passed to Phase 3 which decides whether to call `critiqueDraft()`
  at all. This keeps `critic.js` stateless.

- **Folding `keep_sections` into `rewrite_instructions`:** Keep them as separate top-level fields.
  Phase 3 rewriter needs to query `keep_sections` independently — mixing them with instruction
  text makes parsing fragile.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON parse safety | Custom regex JSON extractor | `JSON.parse(clean)` with markdown strip + 2-attempt retry | The same pattern already in client.js works; Claude rarely wraps in markdown when system prompt says not to |
| Scoring consistency | Custom vote aggregation (multi-call majority) | Single call + low temperature (0.2) | Multi-call adds latency; Claude at temp=0.2 is consistent enough for a scoring rubric |
| Specificity heuristics | Regex for proper nouns in Russian | LLM micro-call (METRICS-03) | Russian proper noun regex is brittle — capitalization isn't reliable in lyrics, word boundaries vary. An LLM handles "Рома", "Лондон", "Арктика" trivially |
| JSON Schema definition | Maintaining a full JSONSchema object | System prompt structure + `json_object` mode | Schema maintenance creates a second source of truth that can drift. System prompt defines the same contract with less overhead. |

**Key insight:** The critic call is inherently nondeterministic — no amount of hand-rolled
post-processing fixes a bad critique. The investment belongs in the prompt quality, not the parser.

---

## Common Pitfalls

### Pitfall 1: Model ID Dot vs Hyphen

**What goes wrong:** Using `anthropic/claude-sonnet-4-6` (hyphen) in the OpenRouter API call
returns a 404 or routes to a different model (or the request silently fails).
**Why it happens:** Anthropic's own API uses hyphens (`claude-sonnet-4-6`). OpenRouter's model
namespace uses dots for version numbers (`anthropic/claude-sonnet-4.6`). Two different namespaces.
**How to avoid:** Always use `anthropic/claude-sonnet-4.6` (dot) for OpenRouter calls. The
OpenRouter permaslug is `anthropic/claude-4.6-sonnet-20260217`.
**Warning signs:** HTTP 404 from OpenRouter, or model responding as an unexpected model.
[VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6 page shows model ID with dot notation]

### Pitfall 2: `total` Field Hallucination

**What goes wrong:** Claude returns a `total` that doesn't equal the sum of the 5 dimension scores
(e.g., scores sum to 9 but `total: 11`). Phase 3 skip gate uses `total >= 12` — a hallucinated
total could incorrectly skip the rewrite step.
**Why it happens:** The model computes the sum but occasionally makes arithmetic errors.
**How to avoid:** After parsing, always re-compute total from dimension scores:
```js
critique.total = critique.story_specificity.score + critique.chorus_identity.score +
  critique.rhyme_quality.score + critique.singability.score + critique.emotional_honesty.score;
```
**Warning signs:** Test assertion `critique.total === sumOfScores` fails.

### Pitfall 3: Missing `rewrite_instructions` for Low-Score Dimensions

**What goes wrong:** The critic returns `score: 1` but `rewrite_instructions: ""` — violating
Phase 2 success criterion 2. Phase 3 rewriter gets no guidance for fixing the weak section.
**Why it happens:** The model "forgets" to include instructions for a dimension it scored low on.
**How to avoid:** In the parser, validate: for each dimension where `score <= 1`, if
`rewrite_instructions` is empty, throw an error and retry. One retry is sufficient.
**Warning signs:** Parsed critique has `score: 1` and `rewrite_instructions: ""`.

### Pitfall 4: Reasoning Mode Leaking Thinking Blocks

**What goes wrong:** If `reasoning` is accidentally enabled (e.g., by copying the generator's
request body), the response `content` is an array of blocks (thinking + text), not a plain string.
The JSON parser receives the raw thinking XML or structured blocks and fails.
**Why it happens:** The generator already uses `reasoning: { max_tokens: 8000 }`, which returns
array-format content. If critic.js is copy-pasted from client.js without removing that parameter,
it inherits the problem.
**How to avoid:** Do NOT pass `reasoning` parameter in critic calls. Keep it absent.
Defensive check: after getting response, always handle content as either string or array:
```js
const content = data.choices?.[0]?.message?.content;
const raw = Array.isArray(content)
  ? content.filter(b => b.type === 'text').map(b => b.text).join('')
  : (content || '');
```
This is the same pattern already in client.js lines 304-308 — copy that defensive logic.

### Pitfall 5: `keep_sections` Empty or Absent

**What goes wrong:** Critic returns `keep_sections: []` (empty) or omits the field. Phase 2
success criterion 3 requires at least 2 sections marked KEEP.
**Why it happens:** The model focuses on what's bad and forgets to mark what's good. Without
explicit instruction, it may return empty `keep_sections`.
**How to avoid:** System prompt states explicitly: "include at least 2 sections — find the
strongest ones even in a weak draft." Parser validation: if `keep_sections.length < 2`, retry.
**Warning signs:** Test `assert.ok(critique.keep_sections.length >= 2)` fails.

### Pitfall 6: Specificity Judge Over-Detecting Proper Nouns

**What goes wrong:** The judge marks `has_proper_nouns: true` for a word like "Тебя" (capitalized
due to line-start) or a common adjective at the start of a sentence.
**Why it happens:** In Russian poetry, lines often start with uppercase — the judge may miscount
these as proper nouns.
**How to avoid:** The judge prompt explicitly says "personal names, brand names, specific place
names" — not just any capitalized word. Test with a fixture that has no proper nouns but has
line-start capitals.

### Pitfall 7: Context Budget Overflow

**What goes wrong:** Song draft (200-250 words) + metrics JSON + specificity result + system prompt
exceeds a practical prompt size, causing slow response or truncated output.
**Why it happens:** The system prompt is long (~30 lines). Metrics JSON is compact. Song is ~250
words. Total should be ~1500-2000 input tokens — well within context window.
**How to avoid:** Compress metrics in user message: only pass `banale_pairs` and
`syllable_violations.line` (not the full violation objects). Keep system prompt rubric
descriptions concise. Monitor token count in logs.
**Note from STATE.md:** "if total context > 4000 tokens, compress critique to bullet points" —
this applies to Phase 3 rewriter context, not the critic call itself. Critic input should stay
well below 4000 tokens.

---

## Code Examples

All patterns verified from official sources and existing codebase.

### Complete `src/ai/critic.js` Module Structure

```js
// src/ai/critic.js
// Two-call LLM critic: specificity judge (METRICS-03) + 5-dimension critique (PIPELINE-03).
// Uses anthropic/claude-sonnet-4.6 via OpenRouter. No new dependencies.

import { config } from '../config.js';

// [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6]
// Note: dot notation is OpenRouter namespace; Anthropic API uses hyphens (claude-sonnet-4-6)
const CRITIC_MODEL = 'anthropic/claude-sonnet-4.6';

// ... CRITIC_SYSTEM_PROMPT (see Pattern 4) ...
// ... SPECIFICITY_JUDGE_PROMPT (see Pattern 5) ...

export async function judgeSpecificity(lyrics) {
  // cheap micro-call, ~100 output tokens
  // returns {has_proper_nouns: boolean, has_time_expressions: boolean}
}

export async function critiqueDraft(lyrics, metrics) {
  // 1. call judgeSpecificity(lyrics) — non-fatal fallback on failure
  // 2. buildCriticUserMessage(lyrics, metrics, specificity)
  // 3. fetch critic call (2 attempts, response_format: json_object)
  // 4. parseCritique(raw) — validates shape, re-computes total, validates rewrite_instructions
  // 5. return critique | null
}
```

### Parsing and Validation

```js
// Source: derived from existing client.js JSON parse pattern (lines 316-323)
function parseCritique(raw) {
  // Strip markdown fences if present (defensive, same as client.js)
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const obj = JSON.parse(clean); // throws on invalid JSON → triggers retry

  const DIMS = ['story_specificity', 'chorus_identity', 'rhyme_quality', 'singability', 'emotional_honesty'];

  for (const dim of DIMS) {
    if (typeof obj[dim]?.score !== 'number') throw new Error(`missing score for ${dim}`);
    const score = obj[dim].score;
    if (score < 0 || score > 3) throw new Error(`score out of range for ${dim}: ${score}`);
    if (score <= 1 && !obj[dim].rewrite_instructions) {
      throw new Error(`missing rewrite_instructions for weak dimension ${dim}`);
    }
  }

  if (!Array.isArray(obj.keep_sections) || obj.keep_sections.length < 2) {
    throw new Error(`keep_sections must have >= 2 entries, got: ${JSON.stringify(obj.keep_sections)}`);
  }

  // Re-compute total to prevent hallucinated arithmetic
  obj.total = DIMS.reduce((sum, dim) => sum + obj[dim].score, 0);

  return obj;
}
```

### Test Fixtures (for node:test)

```js
// src/ai/critic.test.js — structure (not full implementation)
// Runs as: node --test src/ai/critic.test.js
// Environment: requires OPENROUTER_API_KEY in .env
// Note: these are integration tests — they call the real API

// Fixture 1: "bad specificity" — no proper nouns, no time, generic
const GENERIC_DRAFT = `
[Куплет 1]
Он встаёт по утрам и идёт на работу,
Она ждёт его дома с горячим чаем.
Каждый день одно и то же — вот такая суббота,
Так они живут, никуда не уезжая.
[Припев]
Ты мой герой, ты мой идеал,
Ты моя звезда, ты мой свет.
Без тебя бы я не встал,
Дороже тебя в мире нет.
[Куплет 2]
Он сильный и добрый, всегда поддержит,
Она красивая, умная, нежная.
Вместе они пройдут любую нежность,
Их любовь — бесконечная, безбрежная.
[Бридж]
Годы идут, но чувства крепнут,
Счастье живёт в их маленьком доме.
Они никогда не уснут в разлуке,
Их сердца бьются в одном ритме.
[Финал]
Вот такая история любви,
Простая, но честная — живи.
`.trim();

// Expected: has_proper_nouns=false, has_time_expressions=false, Story Specificity score <= 1

// Fixture 2: "good specificity" — proper nouns, time expression, specific scene
const SPECIFIC_DRAFT = `
[Куплет 1]
Шесть утра, а Рома уже шнурует кросс,
Район Митино спит, фонарь горит — и холодно до слёз.
Турник скрипнул, двадцать раз — и выдох в тишину,
Пока соседи спят, считает Рома луну.
[Припев]
С днём рождения, Рома — в путь,
Город спит, а ты — не свернуть.
Впереди всех, и не догнать,
Дорога знает — Рому ей встречать.
[Куплет 2]
В выходной — ружьё, рассвет, болото, грязь,
Три часа в засаде, а потом домой летя.
Мать кричит: «Опять сапожищи в прихожей!»
Рома улыбнётся тихо — мам, ну что ты, Боже...
[Бридж]
Девчонки пишут, а Рома весь в подходе,
Телефон молчит, пока штангу не уронит.
Прочитает позже, усмехнётся — ну ок,
И снова педали — ветер бьёт в висок.
[Финал]
Шесть утра, фонарь, турник — скрип знакомый,
Ещё один рассвет встречает Рома.
`.trim();
// Expected: has_proper_nouns=true, has_time_expressions=true, Story Specificity score >= 2

// Fixture 3: "passing Phase 1 gate" — CLEAN_DRAFT from metrics.test.js
// import CLEAN_DRAFT from metrics.test.js or redefine here
// scoreDraft(CLEAN_DRAFT).skip_pipeline === true
// critiqueDraft(CLEAN_DRAFT, scoreDraft(CLEAN_DRAFT)).total >= 12
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-step LLM lyrics generation | Multi-step G→C→R pipeline | Phase 2-3 of this project | Critic catches quality issues the generator missed |
| python-based rubric scorers | LLM-as-judge via same API | 2024-2025 community shift | Zero new dependencies; same endpoint; cross-model echo-chamber guard via different provider |
| `reasoning.max_tokens` for all calls | Reasoning ON only for generator (Gemini); OFF for critic | Phase 2 decision | Saves ~$0.005/call for critic; rubric scoring doesn't benefit from extended thinking |
| `anthropic/claude-sonnet-4-6` (hyphen) | `anthropic/claude-sonnet-4.6` (dot) | OpenRouter namespace convention | Hyphen version may route to wrong model or return 404 |

**Deprecated/outdated for this project:**
- `response_format: { type: 'json_schema' }` with full schema object: overkill for this use case;
  system prompt + `json_object` achieves the same result with less maintenance overhead.
- `reasoning: { max_tokens: N }` for the critic: budgeted thinking was the old API; Claude 4.6
  now uses adaptive thinking (passes `reasoning` without `max_tokens`), but for the critic we
  want NO thinking at all, so omit the parameter entirely.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `response_format: { type: 'json_object' }` is supported by `anthropic/claude-sonnet-4.6` via OpenRouter | Pattern 2 | If unsupported, fall back to system prompt enforcement only (no response_format). Claude follows strict JSON instructions well even without the parameter. |
| A2 | Claude Sonnet 4.6 at temperature=0.2 gives consistent enough scores for the gate (< ±1 variance on repeated calls) | Pattern 1 | If variance is high, consider reducing to temperature=0.1 or adding a "think before scoring" instruction |
| A3 | The specificity micro-call adds < 1.5s to total latency (well within 150s budget) | Pattern 5 | If latency is a problem, fold the two binary questions into the main critic call as part of the user message |
| A4 | `rewrite_instructions` with a quoted evidence line is achievable in a single call without forcing a second retry | Pattern 4 | May need to add explicit "you MUST quote a line from the draft" instruction and retry validation |

---

## Open Questions

1. **`response_format: { type: 'json_object' }` for Anthropic via OpenRouter — reliably enforced?**
   - What we know: OpenRouter docs confirm both `json_object` and `json_schema` modes available.
     Anthropic-specific note in docs mentions `json_schema` support auto-applies the beta header.
   - What's unclear: Whether `json_object` mode is reliably enforced for Anthropic models routed
     through OpenRouter (vs Google/OpenAI models where it's universally supported).
   - Recommendation: Include system prompt JSON enforcement regardless. Test with `json_object`
     in Wave 0. If Claude returns markdown-wrapped JSON despite the mode, fall back to prompt-only.

2. **Should `AI_CRITIC_MODEL` be a new env var or a hardcoded constant?**
   - What we know: The critic model is intentionally different from the generator (echo chamber
     guard). Making it configurable allows testing with cheaper models.
   - Recommendation: Hardcode as `const CRITIC_MODEL = 'anthropic/claude-sonnet-4.6'` in
     `critic.js` but add an optional `AI_CRITIC_MODEL` env var override (same pattern as
     `config.ai.model`). Add to `src/config.js` as `config.ai.criticModel`.

3. **Is `judgeSpecificity()` worth the extra API call in production?**
   - What we know: It adds ~500ms and ~$0.001 per call. It makes METRICS-03 independently testable.
   - Recommendation: Keep as separate call for Phase 2 (testability). Phase 3 can fold it into
     the critic prompt as an optimization if latency becomes an issue.

4. **What's the exact `npm test` command for Phase 2 tests?**
   - What we know: `package.json` currently has `"test": "node --test src/ai/metrics.test.js"`.
   - Recommendation: Update to `"test": "node --test src/ai/metrics.test.js src/ai/critic.test.js"`
     in Phase 2 Wave 0. Add `"test:critic": "node --test src/ai/critic.test.js"` as a separate
     script for fast isolation.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js built-in fetch | OpenRouter HTTP calls | ✓ | Node 22 | — |
| OPENROUTER_API_KEY env var | All AI calls | ✓ (production .env) | — | Block execution with clear error |
| `anthropic/claude-sonnet-4.6` model on OpenRouter | MODELS-02 | ✓ | Released 2026-02-17 | None — this model is the locked decision |

**Missing dependencies:** None — Phase 2 is code-only with zero new npm packages.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22 built-in) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test src/ai/critic.test.js` |
| Full suite command | `node --test src/ai/metrics.test.js src/ai/critic.test.js` |

**Important:** Phase 2 tests call the real OpenRouter API. They require `OPENROUTER_API_KEY` in
the environment. They are integration tests, not unit tests. They cannot run in CI without the key.
Add a guard at the top of `critic.test.js`:

```js
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[critic.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}
```

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPELINE-03 | `critiqueDraft(draft, metrics)` returns valid JSON with all 5 dimensions, each 0-3, plus total | integration | `node --test src/ai/critic.test.js` | ❌ Wave 0 |
| PIPELINE-03 SC2 | Failing dimension (score 0-1) has non-empty `rewrite_instructions` with a quoted line | integration | `node --test src/ai/critic.test.js` | ❌ Wave 0 |
| PIPELINE-03 SC3 | `keep_sections` has >= 2 entries | integration | `node --test src/ai/critic.test.js` | ❌ Wave 0 |
| METRICS-03 SC4 | `judgeSpecificity()` returns lower Story Specificity for generic draft vs specific draft | integration | `node --test src/ai/critic.test.js` | ❌ Wave 0 |
| PIPELINE-03 SC5 | Phase 1-passing draft (skip_pipeline=true) produces critique `total >= 12` | integration | `node --test src/ai/critic.test.js` | ❌ Wave 0 |
| MODELS-02 | Critic call uses `anthropic/claude-sonnet-4.6` (verify from response or log) | unit (mock) | `node --test src/ai/critic.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run check && node --test src/ai/critic.test.js`
- **Per wave merge:** `node --test src/ai/metrics.test.js src/ai/critic.test.js`
- **Phase gate:** All 6 test cases above green before marking Phase 2 complete

### Wave 0 Gaps

- [ ] `src/ai/critic.js` — module skeleton (exported `judgeSpecificity` and `critiqueDraft`)
- [ ] `src/ai/critic.test.js` — 6 test cases listed above (RED state initially)
- [ ] `package.json` — update `test` script to include `critic.test.js`; add `test:critic` script
- [ ] `src/config.js` — add `config.ai.criticModel` (optional env override for `AI_CRITIC_MODEL`)

---

## Security Domain

Phase 2 adds one new external API call (OpenRouter for critic). The same API key (`OPENROUTER_API_KEY`) used by the generator is reused. No new secrets, no new attack surface.

ASVS categories that apply:
- **V5 Input Validation:** The song lyrics and user details flow into the critic prompt as user message content. Russian text with punctuation is safe for OpenRouter's JSON API; no injection risk from lyrics content.

No additional security requirements beyond what already applies to the generator call.

---

## Sources

### Primary (HIGH confidence)

- `src/ai/client.js` — existing OpenRouter call pattern, response parsing, thinking blocks handling [VERIFIED: file read this session]
- `src/ai/metrics.js` — Phase 1 `scoreDraft()` output contract, used as critic input [VERIFIED: file read this session]
- `openrouter.ai/anthropic/claude-sonnet-4.6` — model ID `anthropic/claude-sonnet-4.6`, released 2026-02-17 [VERIFIED: WebFetch this session]
- `platform.claude.com/docs/en/about-claude/models/overview` — Anthropic API model ID `claude-sonnet-4-6`, extended thinking supported [VERIFIED: WebFetch this session]
- `openrouter.ai/docs/guides/features/structured-outputs` — `json_schema` and `json_object` both available; `json_schema` auto-applies Anthropic beta header [VERIFIED: WebFetch this session]
- `openrouter.ai/docs/guides/best-practices/reasoning-tokens` — reasoning parameter format for Anthropic; adaptive thinking on Claude 4.6 when `reasoning` passed without `max_tokens` [VERIFIED: WebSearch + WebFetch this session]
- `.planning/STATE.md` — locked decisions: critic model, skip threshold, no pipeline loops, context budget [VERIFIED: file read this session]
- `.planning/REQUIREMENTS.md` — exact requirement text for PIPELINE-03, MODELS-02, METRICS-03 [VERIFIED: file read this session]

### Secondary (MEDIUM confidence)

- `openrouter.ai/docs/guides/evaluate-and-optimize/model-migrations/claude-4-6` — adaptive thinking replaces budget-based thinking in Claude 4.6; `verbosity: max` available [VERIFIED: WebFetch this session]
- `openrouter.ai/docs/api/reference/parameters` — `json_object` mode guarantees valid JSON [VERIFIED: WebSearch summary this session]

### Tertiary (LOW confidence / ASSUMED)

- A1: `json_object` reliably enforced for Anthropic models via OpenRouter — inferred from docs but not directly confirmed for the specific `anthropic/claude-sonnet-4.6` model
- A2: Temperature 0.2 sufficient for scoring consistency — common practice, not empirically tested on this model
- A3: Specificity micro-call adds < 1.5s — estimated from typical Claude Sonnet latency on short prompts

---

## Metadata

**Confidence breakdown:**

- Model ID (`anthropic/claude-sonnet-4.6`): HIGH — confirmed on openrouter.ai model page, cross-checked with Anthropic docs
- OpenRouter call structure: HIGH — verified against existing working code in client.js
- JSON output strategy (`json_object` + system prompt): MEDIUM — `json_object` supported per docs; behavior with Anthropic provider specifically needs one integration test to confirm
- Reasoning OFF for critic: HIGH — confirmed from OpenRouter reasoning docs; no parameter = no thinking
- METRICS-03 specificity judge prompt: MEDIUM — pattern is standard LLM-as-judge; exact prompt phrasing needs iteration
- Test fixtures: HIGH — GENERIC_DRAFT has no proper nouns or time expressions (verifiable by inspection); SPECIFIC_DRAFT (Рома, Митино, Шесть утра) has both

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (OpenRouter model availability stable; JSON output API stable; prompt design may need iteration)
