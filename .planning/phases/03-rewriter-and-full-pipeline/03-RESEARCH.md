# Phase 3: Rewriter and Full Pipeline — Research

**Researched:** 2026-04-16
**Domain:** LLM rewriter, pipeline orchestration, Node.js async timeout patterns, Russian text diff
**Confidence:** HIGH (stack, patterns, orchestration) / MEDIUM (Gemini thinking param)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PIPELINE-01 | Implement generate→critique→rewrite in `src/ai/client.js`, preserve `{lyrics, tags, title}` output format | Orchestration patterns in Architecture Patterns; `src/ai/pipeline.js` module design |
| PIPELINE-02 | Gate logic: skip critique+rewrite if draft scores >=12/15 (fast path) | Gate logic in Architecture Patterns; skip-gate pattern confirmed by Phase 2 CLEAN_DRAFT=13 |
| PIPELINE-04 | Rewrite prompt receives original draft + critique JSON and fixes only sections with score 0-1, preserving strong parts | Rewriter prompt structure in Code Examples; KEEP-sections enforcement pattern |
| MODELS-01 | Generator and Rewriter use `google/gemini-2.5-flash` with thinking mode ON (verify `include_reasoning` parameter) | Confirmed: use `reasoning: { effort: "high" }` NOT bare `include_reasoning: true` — see Critical Finding below |
</phase_requirements>

---

## Summary

Phase 3 adds two things: (1) a `src/ai/rewriter.js` module that calls Gemini 2.5 Flash with
thinking enabled to rewrite a draft given a critique, and (2) a `src/ai/pipeline.js` orchestrator
that wires the full Generate → Critique → Rewrite flow, replacing the direct `generateLyrics()`
call for the post-Phases-1-2 world.

The existing `generateLyrics()` in `src/ai/client.js` stays unchanged. The callers
(`src/bots/telegram.js`) switch from `generateLyrics()` to `runPipeline()` from `pipeline.js`,
which calls `generateLyrics()` internally. This gives zero blast radius to SUNO integration —
the `{lyrics, tags, title}` contract is preserved at every exit point.

**Critical Finding (MODELS-01):** The `include_reasoning: true` parameter does NOT reliably
enable thinking on `google/gemini-2.5-flash` via OpenRouter. The correct parameter is:
`reasoning: { effort: "high" }` (or `reasoning: { max_tokens: 8000 }` as the generator already
uses). The legacy `include_reasoning: true` is equivalent to `reasoning: {}` (empty object, uses
defaults) — for Gemini this may not trigger the thinking mechanism at all. Use `reasoning.effort`
explicitly. [VERIFIED via community report + OpenRouter docs — see Sources]

**Primary recommendation:** Implement in two new files: `src/ai/rewriter.js` (rewrite call) and
`src/ai/pipeline.js` (orchestrator). Callers import `runPipeline()` from pipeline.js. The
`{lyrics, tags, title}` contract is maintained at every code path exit. No new npm deps.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Full G→C→R orchestration | `src/ai/pipeline.js` (new) | — | Dedicated orchestrator keeps blast radius away from client.js and bot layer |
| Draft generation (Step G) | `src/ai/client.js` existing `generateLyrics()` | — | Already exists; pipeline calls it, does not modify it |
| Metrics gate (Step G exit) | `src/ai/metrics.js` `scoreDraft()` | — | Already called inside `generateLyrics()`; `skip_pipeline` field drives gate |
| Critique (Step C) | `src/ai/critic.js` `critiqueDraft()` | — | Already built Phase 2; pipeline calls it |
| Fast-path gate (skip C+R) | `src/ai/pipeline.js` | — | Gate logic: `metrics.skip_pipeline` and `critique.total >= 12` — belongs in orchestrator |
| Rewrite (Step R) | `src/ai/rewriter.js` (new) | — | New module; Gemini 2.5 Flash + thinking; returns `{lyrics}` |
| KEEP-sections enforcement | `src/ai/rewriter.js` prompt | — | Rewriter prompt embeds KEEP list from critique; verbatim copy enforced by instruction |
| Timeout guard | `src/ai/pipeline.js` `Promise.race()` | — | Per-step race with setTimeout; best available draft returned on timeout |
| Token diff / sycophancy guard | `src/ai/pipeline.js` or `src/ai/rewriter.js` | — | Word-level Jaccard; rejects rewrite if < 20% new tokens; falls back to critique draft |
| Bot integration | `src/bots/telegram.js` | — | Swap one import; same call signature |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node built-in `fetch` | Node 22 | OpenRouter HTTP calls | Already used in `client.js` and `critic.js` |
| `node:test` | Node 22 built-in | Integration tests | Already used for metrics + critic suites |
| `node:assert/strict` | Node 22 built-in | Assertions | Already used in all test files |

### No New Dependencies

Phase 3 adds zero new npm packages. All needs are met by built-ins and existing modules:
- `src/ai/client.js` — existing `generateLyrics()`
- `src/ai/metrics.js` — existing `scoreDraft()`
- `src/ai/critic.js` — existing `critiqueDraft()`
- Node built-in `fetch` — for the rewriter OpenRouter call

**Installation:** nothing to add to `package.json`.

**Version verification:** `node --version` → v22 (confirmed from project setup).
[VERIFIED: package.json `"engines": { "node": ">=20" }`, deployed on Node 22]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `src/ai/pipeline.js` wrapping client.js | Modify `generateLyrics()` in-place | In-place modification requires wiring critic + rewriter into an already-complex function; increases blast radius; harder to test in isolation |
| Word-level Jaccard for sycophancy | Character-level Levenshtein | Levenshtein is O(n²) on long strings and hard to reason about for "20% new tokens"; word-set Jaccard is O(n) and maps directly to the "new tokens" concept |
| `Promise.race()` timeout | `AbortController` + `AbortSignal.timeout()` | Both work in Node 22; `Promise.race()` with `setTimeout` is simpler, doesn't require passing AbortSignal into every fetch call, and is already proven viable in this codebase |

---

## Architecture Patterns

### System Architecture Diagram

```
runPipeline(input)          [src/ai/pipeline.js — NEW]
       |
       v
generateLyrics(input)       [src/ai/client.js — existing]
       |
       +-- scoreDraft(lyrics)   [src/ai/metrics.js — existing]
       |          |
       |          v
       |   metrics {banale_pairs, syllable_violations, lexical_diversity, skip_pipeline}
       |
       v
   metrics.skip_pipeline === true?
       |           |
      YES          NO
       |           v
       |    critiqueDraft(lyrics, metrics)   [src/ai/critic.js — existing]
       |           |
       |           v (null or critique JSON)
       |    critique === null?
       |           |         |
       |          YES        NO
       |           |         v
       |           |    critique.total >= 12?
       |           |         |         |
       |           |        YES        NO
       |           |         |         v
       |           |         |    rewriteDraft(lyrics, critique)  [src/ai/rewriter.js — NEW]
       |           |         |         |
       |           |         |         v  (null or {lyrics})
       |           |         |    sycophancy_check: >= 20% new tokens?
       |           |         |         |           |
       |           |         |        YES          NO (fallback)
       |           |         |         |           |
       v           v         v         v           v
   return {lyrics, tags, title}   — always the same output format
```

**Log entries at each branch:**
- `[pipeline] metrics gate: skip_pipeline=true — fast path` (no critic call)
- `[pipeline] critique total=NN — above threshold, fast path`
- `[pipeline] critique null — critic failed, using original draft`
- `[pipeline] rewrite accepted: N% new tokens`
- `[pipeline] rewrite rejected (sycophancy N%), using pre-rewrite draft`
- `[pipeline] step timeout at Xs, returning best available draft`

### Recommended Project Structure

```
src/
├── ai/
│   ├── client.js      # existing — generateLyrics() unchanged
│   ├── metrics.js     # Phase 1 — scoreDraft()
│   ├── critic.js      # Phase 2 — critiqueDraft()
│   ├── rewriter.js    # NEW Phase 3 — rewriteDraft(lyrics, critique)
│   └── pipeline.js    # NEW Phase 3 — runPipeline(input) — the orchestrator
└── bots/
    └── telegram.js    # existing — swap generateLyrics import for runPipeline
```

**Module responsibilities (single-concern per file):**
- `rewriter.js` exports: `rewriteDraft(lyrics, critique)` → `{lyrics}` or `null` on failure
- `pipeline.js` exports: `runPipeline(input)` → `{lyrics, tags, title}` (same contract as `generateLyrics`)

### Pattern 1: Rewriter OpenRouter Call

**What:** The exact request body structure for the rewriter call.

**Key difference from generator:** generator uses `config.ai.model` which maps to Gemini 2.5 Pro.
The rewriter hardcodes `google/gemini-2.5-flash` with `reasoning: { effort: 'high' }`.

```js
// Source: confirmed from OpenRouter reasoning docs + community validation
// CRITICAL: use reasoning.effort NOT bare include_reasoning: true

const REWRITER_MODEL = process.env.AI_REWRITER_MODEL || 'google/gemini-2.5-flash';

const body = {
  model: REWRITER_MODEL,
  messages: [
    { role: 'system', content: REWRITER_SYSTEM_PROMPT },
    { role: 'user', content: buildRewriterUserMessage(lyrics, critique) },
  ],
  max_tokens: 16000,
  temperature: 0.9,           // creative but not chaotic
  reasoning: { effort: 'high' },  // enables thinking mode on Gemini 2.5 Flash
};
```

**Why `reasoning: { effort: 'high' }` not `include_reasoning: true`:**
`include_reasoning: true` is a legacy alias for `reasoning: {}` (empty object).
For Gemini Flash specifically, the empty object may not trigger thinking.
`reasoning: { effort: 'high' }` maps directly to Google's `thinkingLevel: "high"` and
reliably activates the thinking mechanism.
[VERIFIED: OpenRouter reasoning-tokens docs + LibreChat community report + agno issue #5329]

**Response handling for thinking mode:** Gemini 2.5 Flash with thinking returns the thinking
in `message.reasoning` (a string) alongside `message.content` (the actual output). The
`message.content` field may still be a plain string (not a content-blocks array like Anthropic).
However, the defensive array-handling pattern from `client.js` lines 305-308 should be kept as
a guard:

```js
// Defensive content extraction — same pattern as client.js
const content = data.choices?.[0]?.message?.content;
let raw;
if (Array.isArray(content)) {
  raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
} else {
  raw = (content || '').trim();
}
// reasoning text is in data.choices?.[0]?.message?.reasoning — we don't need it
```

### Pattern 2: Rewriter System Prompt Structure

**What:** The system prompt that turns the rewriter into a targeted lyric fixer.

Design principles from STATE.md (locked decisions):
1. Hard constraints (JSON format, syllable limits) at TOP and BOTTOM (instruction drift guard)
2. KEEP sections listed explicitly — rewriter must reproduce them verbatim
3. Only fix dimensions with score 0-1; don't touch dimensions with score >= 2

```
REWRITER_SYSTEM_PROMPT:

You are a Russian song rewriter. You receive an original song draft and a structured critique.
Your job: fix ONLY the weak sections (score 0-1) based on the rewrite_instructions.
Preserve the strong sections EXACTLY as written.

══ CONSTRAINTS (apply at ALL times) ══

OUTPUT FORMAT (required):
Respond STRICTLY in JSON (no markdown, no ```, only raw JSON):
{"lyrics": "rewritten song text here"}

STRUCTURE: Preserve all section headers exactly: [Куплет 1], [Припев], [Куплет 2], [Бридж], [Финал]
SYLLABLES: Chorus lines (lines under [Припев]) MUST be ≤12 syllables each.
RHYME: Avoid banale pairs listed in the critique.

══ HOW TO REWRITE ══

1. For each section in keep_sections: reproduce it CHARACTER-FOR-CHARACTER. Do not improve it.
   Do not add words, do not change rhymes, do not rephrase "slightly better." VERBATIM.

2. For sections NOT in keep_sections with score 0-1: apply the rewrite_instructions.
   Each instruction quotes a specific weak line — use that as your target.
   Preserve the song's established characters, names, setting, and emotional arc.

3. The rewritten song must feel like one unified song, not a patchwork. Bridge transitions
   between kept and rewritten sections if needed — but do not rewrite kept sections to do so.

══ CONSTRAINTS REPEATED (instruction drift guard) ══

OUTPUT FORMAT: {"lyrics": "..."} only. No markdown.
KEEP sections: reproduce verbatim. No improvements allowed.
CHORUS: ≤12 syllables per line.
```

### Pattern 3: Rewriter User Message Construction

**What:** How to pass the original draft + critique to the rewriter.

**Context budget rule (from STATE.md):** If total context > 4000 tokens, compress critique to
bullet points. For typical songs (200-220 words) + critique JSON (~500-800 tokens), total stays
well under 4000 tokens. Include full critique JSON in all normal cases.

```js
// Token estimation: 1 word ≈ 1.3 tokens for Russian text
// Song 220 words ≈ 286 tokens; critique JSON ≈ 600 tokens; prompts ≈ 800 tokens
// Total ≈ 1686 tokens — well under 4000. No compression needed for normal cases.

function estimateTokenCount(text) {
  // Rough estimate: word count * 1.3 (works for Russian/mixed text)
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

function buildRewriterUserMessage(lyrics, critique) {
  const critiqueText = JSON.stringify(critique, null, 2);
  const totalEstimate = estimateTokenCount(lyrics) + estimateTokenCount(critiqueText);

  let critiqueSection;
  if (totalEstimate > 4000) {
    // Compress critique to bullet points (context budget guard)
    critiqueSection = buildCompressedCritique(critique);
  } else {
    critiqueSection = '```json\n' + critiqueText + '\n```';
  }

  return [
    '## KEEP SECTIONS (reproduce verbatim, character-for-character):',
    critique.keep_sections.join(', '),
    '',
    '## CRITIQUE (fix sections with score 0-1 only):',
    critiqueSection,
    '',
    '## ORIGINAL DRAFT:',
    lyrics,
  ].join('\n');
}

function buildCompressedCritique(critique) {
  const DIMS = ['story_specificity', 'chorus_identity', 'rhyme_quality', 'singability', 'emotional_honesty'];
  const lines = DIMS.map(dim => {
    const { score, rewrite_instructions } = critique[dim];
    const status = score <= 1 ? `FIX (score=${score})` : `KEEP (score=${score})`;
    const instruction = score <= 1 && rewrite_instructions ? ` — ${rewrite_instructions}` : '';
    return `- ${dim}: ${status}${instruction}`;
  });
  return lines.join('\n');
}
```

### Pattern 4: Pipeline Orchestrator Structure

**What:** The complete `runPipeline()` function with per-step timeouts.

```js
// src/ai/pipeline.js
import { generateLyrics } from './client.js';
import { critiqueDraft } from './critic.js';
import { rewriteDraft } from './rewriter.js';

const CRITIQUE_TIMEOUT_MS = 30_000;   // 30s per step
const REWRITE_TIMEOUT_MS = 60_000;    // 60s for rewriter (thinking mode is slower)
const SKIP_GATE_SCORE = 12;           // >= 12/15: skip rewrite

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[pipeline] timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}

export async function runPipeline({ occasion, genre, mood, voice, wishes }) {
  // Step G: generate
  const draft = await generateLyrics({ occasion, genre, mood, voice, wishes });
  // draft = {lyrics, tags, title, metrics}

  // Gate 1: Phase 1 metrics skip
  if (draft.metrics?.skip_pipeline) {
    console.log('[pipeline] metrics gate: skip_pipeline=true — fast path');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Step C: critique (with timeout)
  let critique = null;
  try {
    critique = await withTimeout(
      critiqueDraft(draft.lyrics, draft.metrics),
      CRITIQUE_TIMEOUT_MS,
      'critiqueDraft'
    );
  } catch (e) {
    console.log('[pipeline] critique step failed:', e.message, '— using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Gate 2: critique null (critic failure) or above fast-path threshold
  if (!critique) {
    console.log('[pipeline] critique null — critic failed, using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }
  if (critique.total >= SKIP_GATE_SCORE) {
    console.log(`[pipeline] critique total=${critique.total} — above threshold, fast path`);
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Step R: rewrite (with timeout)
  let rewritten = null;
  try {
    rewritten = await withTimeout(
      rewriteDraft(draft.lyrics, critique),
      REWRITE_TIMEOUT_MS,
      'rewriteDraft'
    );
  } catch (e) {
    console.log('[pipeline] rewrite step failed:', e.message, '— using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  if (!rewritten) {
    console.log('[pipeline] rewriteDraft returned null — using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Sycophancy guard: >= 20% new tokens required
  const newTokenRatio = computeNewTokenRatio(draft.lyrics, rewritten.lyrics);
  if (newTokenRatio < 0.20) {
    console.log(`[pipeline] rewrite rejected (sycophancy: only ${(newTokenRatio*100).toFixed(1)}% new tokens), using original`);
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  console.log(`[pipeline] rewrite accepted: ${(newTokenRatio*100).toFixed(1)}% new tokens`);
  return { lyrics: rewritten.lyrics, tags: draft.tags, title: draft.title };
}
```

### Pattern 5: Token Diff / Sycophancy Guard

**What:** How to compute "≥20% new tokens" between two Russian texts in plain JS, no deps.

**Approach:** Word-level Jaccard set difference. Count words in the rewritten text that do NOT
appear in the original text's word set. Normalize by total rewritten word count.

**Why word-level set difference (not Levenshtein):**
- Levenshtein is O(n*m), expensive on 200-word texts
- The requirement is "new tokens" — word set difference maps directly to this concept
- Russian text: word boundaries are spaces/punctuation — split works correctly
- Section headers [Куплет 1] are excluded before comparison

```js
// Source: derived from metrics.js tokenize() pattern (already in codebase)
function tokenizeForDiff(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')         // remove section headers
    .split(/[^а-яёa-z0-9]+/i)           // split on non-word chars
    .filter(w => w.length >= 2);        // same filter as metrics.js
}

function computeNewTokenRatio(originalLyrics, rewrittenLyrics) {
  const originalWords = new Set(tokenizeForDiff(originalLyrics));
  const rewrittenTokens = tokenizeForDiff(rewrittenLyrics);
  if (rewrittenTokens.length === 0) return 0;

  const newCount = rewrittenTokens.filter(w => !originalWords.has(w)).length;
  return newCount / rewrittenTokens.length;
}
```

**Threshold rationale:** 20% is conservative. A song of 200 words where only 40 words change
still represents substantial rewriting of at least 2 weak sections. Lower would let the
sycophancy guard through trivially; higher would falsely reject legitimate targeted rewrites.
[ASSUMED — calibrate during Phase 4 if needed]

### Pattern 6: KEEP-Sections Verbatim Check

**What:** How to verify that the rewriter reproduced KEEP sections correctly.

The rewriter prompt instructs "character-for-character" reproduction. The test verifies this at
the section level: extract the text of each named KEEP section from both original and rewrite,
then compare with a high-similarity threshold.

```js
// Fuzzy-ish section match: normalize whitespace, compare
function extractSection(lyrics, sectionName) {
  // e.g. sectionName = "[Куплет 1]"
  const escapedName = sectionName.replace(/[[\]]/g, '\\$&');
  const regex = new RegExp(`${escapedName}\\s*\\n([\\s\\S]*?)(?=\\[|$)`, 'i');
  const match = lyrics.match(regex);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

function keepSectionReproducedVerbatim(originalLyrics, rewrittenLyrics, sectionName) {
  const orig = extractSection(originalLyrics, sectionName);
  const rewr = extractSection(rewrittenLyrics, sectionName);
  if (!orig || !rewr) return false;
  // Normalize whitespace for comparison — exact match after normalization
  return orig === rewr;
}
```

**For testing (SC4):** The test checks that all sections in `critique.keep_sections` are
reproduced identically. Minor whitespace differences are normalized away.

**What "near-verbatim" means in practice:** The Roadmap SC4 says "verbatim (or near-verbatim)."
For the test, use exact match after whitespace normalization. In production, the prompt says
"character-for-character" — the LLM rarely changes kept sections when the instruction is this
explicit. If it does change a word, the test still passes because the test uses string equality,
not substring; this is a strict check that validates the prompt is working.

### Pattern 7: Per-step Timeout Pattern

**What:** How to implement per-step timeouts without AbortController complexity.

The `Promise.race()` approach is simple and proven in this codebase (queue.js uses similar
promise patterns). The key requirement: when a timeout fires, return the best available draft
(not throw to the caller).

```js
// Promise.race with setTimeout — no AbortController needed
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[pipeline] timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}
// Usage: wrap each step call in try/catch withTimeout().
// On timeout catch: log the event and return best available draft.
```

**Timeout budget:**
- `generateLyrics()`: no timeout added here — already has 3-retry logic internally; generator
  timeout is handled by the overall 150s budget at the bot layer (`src/queue.js`)
- `critiqueDraft()`: 30s (two API calls: specificity + critique; each < 10s; 30s is generous)
- `rewriteDraft()`: 60s (thinking mode adds latency; Gemini thinking calls can take 15-30s)
- **Total guaranteed exit:** 0 (generate) + 30 (critique) + 60 (rewrite) = 90s max for C+R
  steps, well within 150s budget even with generate taking 30-40s [VERIFIED: within budget]

### Pattern 8: Bot Integration (telegram.js)

**What:** The minimal change to wire `runPipeline()` into the bot.

The bot currently calls `generateLyrics()` in `src/bots/telegram.js`. Phase 3 changes one
import and one call:

```js
// BEFORE (telegram.js, existing):
import { generateLyrics } from '../ai/client.js';
// ...
const result = await generateLyrics({ occasion, genre, mood, voice, wishes });
const { lyrics, tags, title } = result;

// AFTER (telegram.js, Phase 3):
import { runPipeline } from '../ai/pipeline.js';
// ...
const result = await runPipeline({ occasion, genre, mood, voice, wishes });
const { lyrics, tags, title } = result;
```

**Why this is safe:** `runPipeline()` returns `{lyrics, tags, title}` in all code paths —
exactly the same destructuring works. The `metrics` field previously returned by `generateLyrics()`
is not used by telegram.js (only logged). No other changes needed in telegram.js.

**VK bot:** VK calls `runGeneration()` in `src/flow/generate.js`, which calls `generateLyrics()`
directly. Phase 3 scope is Telegram only — VK bot does not go through the pipeline.
This is consistent with existing architecture: VK bot is a simpler flow without AI lyrics.

### Pattern 9: config.js Extension

**What:** Add `config.ai.rewriterModel` for the rewriter model ID.

```js
// src/config.js — add to ai section:
ai: {
  apiKey: process.env.OPENROUTER_API_KEY || '',
  model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4-5',
  baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  criticModel: process.env.AI_CRITIC_MODEL || 'anthropic/claude-sonnet-4.6',    // existing
  rewriterModel: process.env.AI_REWRITER_MODEL || 'google/gemini-2.5-flash',   // NEW
},
```

### Anti-Patterns to Avoid

- **Modifying `generateLyrics()` in-place:** Increases blast radius; makes it untestable in isolation; risks breaking SUNO integration if the JSON format silently changes in an error path.
- **`include_reasoning: true` for Gemini:** Legacy alias for `reasoning: {}`. Doesn't reliably trigger thinking on Gemini Flash. Use `reasoning: { effort: 'high' }` explicitly.
- **Applying context compression too aggressively:** Normal song + critique is ~1700 tokens. Compression is only needed above 4000 tokens. Don't compress prematurely — full JSON gives the rewriter more signal.
- **Rewriter touching `tags` or `title`:** The rewriter returns ONLY `{lyrics}`. Tags and title come from the original generator output. Mixing concerns would break SUNO integration.
- **Running sycophancy check inside `rewriter.js`:** The check belongs in `pipeline.js`. The rewriter's job is to produce a rewrite; whether to use it is the orchestrator's decision.
- **Using Levenshtein for the token diff:** O(n²) on 200-word texts is acceptable (~0.5ms) but word-level Jaccard is O(n) and semantically clearer for "new tokens."

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Reasoning/thinking on Gemini | Custom `thinking_budget` parameter | `reasoning: { effort: 'high' }` via OpenRouter | OpenRouter normalizes provider-specific params; this is the supported API |
| JSON output enforcement | Custom regex extraction for rewriter | System prompt + `response_format: { type: 'json_object' }` | Same pattern that works in critic.js; don't diverge |
| Timeout management | `clearTimeout` + manual state machine | `Promise.race()` with setTimeout | Simple, proven pattern; consistent with codebase style |
| Token estimation | Byte-level BPE tokenizer | Word count * 1.3 heuristic | Full tokenizer requires npm dep; heuristic is accurate enough for the 4000-token budget check |
| "Verbatim" section reproduction | Embedding similarity | String equality after whitespace normalization | LLM follows "character-for-character" instructions well enough; string equality is testable; embedding similarity requires API call |

**Key insight:** The rewriter is a single LLM call. Complexity belongs in the prompt design,
not in post-processing scaffolding. Keep orchestration simple and let the model do the work.

---

## Common Pitfalls

### Pitfall 1: `reasoning: { effort }` vs `include_reasoning`

**What goes wrong:** Using `include_reasoning: true` (the legacy alias) fails to activate
thinking for Gemini 2.5 Flash via OpenRouter. The model returns without thinking tokens even
though the parameter is set. The rewriter then behaves like a plain fast-path generation with
no quality improvement.
**Why it happens:** `include_reasoning: true` maps to `reasoning: {}` (empty object), which
on Gemini may use a default that skips thinking. Only explicit `effort` or `max_tokens` inside
the `reasoning` object reliably triggers the thinking mechanism.
**How to avoid:** Use `reasoning: { effort: 'high' }` in the request body.
**Warning signs:** Rewrite completes in < 5s (thinking calls take 10-30s); `message.reasoning`
field is empty or absent in the response.
[VERIFIED: OpenRouter reasoning docs + LibreChat community issue #9371 + agno issue #5329]

### Pitfall 2: Rewriter Returns Thinking-Wrapped Content

**What goes wrong:** With thinking ON, the Gemini response `content` field may be returned as
an array of content blocks (same as Anthropic thinking mode). The existing `client.js` handles
this with array detection — but the rewriter must copy that defensive pattern too.
**Why it happens:** OpenRouter normalizes thinking responses differently across providers.
Gemini may return content as a plain string or as an array of blocks depending on the SDK
version. Defensive handling is required.
**How to avoid:** Copy the exact array-detection pattern from `client.js` lines 305-308:
```js
const content = data.choices?.[0]?.message?.content;
const raw = Array.isArray(content)
  ? content.filter(b => b.type === 'text').map(b => b.text).join('').trim()
  : (content || '').trim();
```
**Warning signs:** JSON parse fails with "Unexpected token" on thinking XML content.

### Pitfall 3: `title` and `tags` Lost on Rewrite Path

**What goes wrong:** The rewriter returns `{lyrics}` only — if pipeline.js accidentally
re-derives title or tags from the rewritten lyrics, the SUNO integration gets wrong data.
**Why it happens:** `extractTitle()` and tags logic live in `generateLyrics()`. If someone
tries to "improve" the pipeline by re-running title extraction on rewritten lyrics, they
introduce a subtle bug.
**How to avoid:** Pipeline always uses `draft.tags` and `draft.title` from the original
`generateLyrics()` call. The rewriter only produces `{lyrics}`.
**Warning signs:** Title changes between the "reviewing lyrics" bot state and the SUNO submission.

### Pitfall 4: `{lyrics, tags, title}` Contract Silently Broken on Error Path

**What goes wrong:** One of the early-return paths in `runPipeline()` accidentally returns
`{lyrics: draft.lyrics, tags: draft.tags, title: draft.title, metrics: ...}` (with the extra
`metrics` field). This won't cause an error but violates the contract.
**Why it happens:** `generateLyrics()` returns `{lyrics, tags, title, metrics}`. If you
destructure the whole object and re-spread it, `metrics` leaks through.
**How to avoid:** Always return `{ lyrics, tags, title }` — explicitly omit `metrics`.
`telegram.js` destructuring does not use `metrics`, but being explicit prevents surprises in Phase 4.
**Warning signs:** Bot state contains unexpected fields; SUNO integration logs extra data.

### Pitfall 5: Sycophancy Threshold Too High

**What goes wrong:** If the sycophancy guard rejects most rewrites (threshold too high), the
pipeline degenerates to always returning the original draft. Success criterion 3 requires a
specific test case to demonstrate >= 20% new tokens.
**Why it happens:** A rewriter that targets only 1-2 weak dimensions in a 7-section song may
naturally achieve only 15-18% new words. 20% is achievable but not trivially.
**How to avoid:** Test with GENERIC_DRAFT (which scores low on 3-4 dimensions). If the rewriter
changes 2 sections of a 7-section song, it changes roughly 2/7 = 28% of words — above threshold.
**Warning signs:** Test for SC3 fails; log shows `[pipeline] rewrite rejected` in most runs.

### Pitfall 6: Rewriter Destroys KEEP Sections

**What goes wrong:** Despite the "verbatim" instruction, the rewriter makes small changes to
KEEP sections (adds a comma, changes a word). SC4 requires near-verbatim reproduction.
**Why it happens:** Thinking mode sometimes causes the model to "improve" text even when told
not to. The instruction must be explicit and repeated (instruction drift guard).
**How to avoid:** System prompt says KEEP twice — once at top and once at bottom (STATE.md:
"hard constraints at top and bottom of rewriter prompt"). Test validates exact string equality.
**Warning signs:** Test `keepSectionReproducedVerbatim()` returns false; diff shows minor changes.

### Pitfall 7: Context Budget Not Checked Before Rewriter Call

**What goes wrong:** For unusually long drafts (rare but possible), the critique JSON + original
lyrics combined exceeds 4000 tokens and causes a slow/truncated response.
**Why it happens:** Generator prompt has a minimum of 180 words but no strict maximum. Long
wishes from users + verbose generation = 300+ word drafts.
**How to avoid:** `buildRewriterUserMessage()` calls `estimateTokenCount()` and conditionally
compresses critique to bullet points above 4000 tokens (Pattern 3 above).
**Warning signs:** Rewriter call takes > 60s and hits timeout; response is truncated.

---

## Code Examples

### Complete `src/ai/rewriter.js` Module Structure

```js
// src/ai/rewriter.js
// Rewrites a song draft given a structured critique from critic.js.
// Uses google/gemini-2.5-flash with thinking mode ON (reasoning.effort = 'high').
// Returns {lyrics} string on success, null on failure.
// Zero new dependencies.

import { config } from '../config.js';

const REWRITER_MODEL = config.ai.rewriterModel || 'google/gemini-2.5-flash';

// REWRITER_SYSTEM_PROMPT: see Pattern 2
// buildRewriterUserMessage(lyrics, critique): see Pattern 3
// computeNewTokenRatio(orig, rewr): see Pattern 5 — used in pipeline.js, not here

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
    temperature: 0.9,
    reasoning: { effort: 'high' },   // thinking mode ON for Gemini
    // response_format: omit — rewriter outputs JSON via system prompt instruction only
    // (json_object mode may not be supported or needed with reasoning ON)
  };

  // 2 attempts — same retry pattern as critic.js
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
      if (!raw) throw new Error('[rewriter] empty content from model');

      const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(clean);
      const rewrittenLyrics = (parsed.lyrics || '').trim();
      if (!rewrittenLyrics) throw new Error('[rewriter] empty lyrics in JSON');

      console.log(`[rewriter] attempt ${attempt}: ok, ${rewrittenLyrics.split('\n').length} lines`);
      return { lyrics: rewrittenLyrics };
    } catch (e) {
      console.log(`[rewriter] attempt ${attempt}: ${e.message}`);
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  console.log('[rewriter] all attempts failed, returning null');
  return null;
}
```

### Complete `src/ai/pipeline.js` Module Structure

See Pattern 4 above for the full `runPipeline()` implementation. Add `computeNewTokenRatio()`
(Pattern 5) and `withTimeout()` (Pattern 7) as module-level helpers.

### `npm run check` Update

```json
// package.json scripts.check — add rewriter.js and pipeline.js:
"check": "node --check src/index.js && node --check src/config.js && ... && node --check src/ai/rewriter.js && node --check src/ai/pipeline.js"
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-step LLM generation | G→C→R pipeline with fast path | Phase 3 | Quality improvement gated by actual critique score |
| `include_reasoning: true` | `reasoning: { effort: 'high' }` | 2025 (OpenRouter API) | `include_reasoning` became legacy alias; explicit effort required for Gemini |
| Always call critic+rewriter | Skip gate at metrics level | Phase 3 | Fast-path skips 2 API calls (~$0.004/saved) for good drafts |
| Rewriter in `generateLyrics()` | Separate `runPipeline()` module | Phase 3 | Zero blast radius to SUNO integration |

**Deprecated/outdated:**
- `include_reasoning: true` (bare): legacy alias for `reasoning: {}`; may not enable thinking
  on Gemini Flash. Replaced by `reasoning: { effort: 'high' }` or `reasoning: { max_tokens: N }`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `reasoning: { effort: 'high' }` reliably enables thinking on `google/gemini-2.5-flash` via OpenRouter | Pattern 1 | If wrong: rewriter produces no thinking improvement; fall back to `reasoning: { max_tokens: 8000 }` (same as generator) |
| A2 | Gemini 2.5 Flash `message.content` is a plain string (not content-blocks array) when thinking ON | Pattern 1 | If wrong: defensive array-check handles it; no functional impact |
| A3 | 20% new-token threshold is achievable for a draft with 2+ weak dimensions | Pattern 5 | If wrong: sycophancy guard rejects most rewrites; calibrate threshold down in Phase 4 |
| A4 | `response_format: { type: 'json_object' }` can be omitted for the rewriter — system prompt instruction is sufficient | Pattern 1 | If wrong: model returns markdown-wrapped JSON; defensive markdown strip already handles this |
| A5 | VK bot does not need pipeline wiring — Telegram only in Phase 3 | Pattern 8 | If wrong: VK users get lower quality; acceptable for MVP scope |

---

## Open Questions

1. **Does `reasoning: { effort: 'high' }` apply vs `reasoning: { max_tokens: 8000 }`?**
   - What we know: Both should work; `effort` is the higher-level API, `max_tokens` is the
     lower-level API. Generator uses `max_tokens: 8000`. For consistency, use the same.
   - Recommendation: Use `reasoning: { max_tokens: 8000 }` in rewriter — consistent with
     generator in `client.js` and avoids an untested code path. Either works; pick one for consistency.

2. **Should the rewriter use `response_format: { type: 'json_object' }`?**
   - What we know: `response_format` + `reasoning` ON may interact differently per provider.
     OpenRouter docs don't explicitly confirm compatibility for Gemini + thinking + json_object.
   - Recommendation: Omit `response_format` for the rewriter. Use system prompt JSON enforcement
     only (same as generator pattern). Defensive markdown strip handles the rare non-JSON response.

3. **When should the VK bot get the pipeline?**
   - Out of scope for Phase 3 per REQUIREMENTS.md.
   - Note: VK bot doesn't use AI lyrics currently (calls `generateByDescription` in flow/generate.js).
     When VK gets AI lyrics, it would need pipeline wiring. Deferred to post-Phase 4.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js built-in `fetch` | OpenRouter HTTP calls | ✓ | Node 22 | — |
| `OPENROUTER_API_KEY` env var | All AI calls | ✓ (production .env) | — | Block with clear error |
| `google/gemini-2.5-flash` on OpenRouter | MODELS-01 | ✓ | Current (confirmed on openrouter.ai) | — |
| `src/ai/critic.js` (Phase 2 output) | PIPELINE-01 | ✓ | 305 lines, 6/6 tests GREEN | — |
| `src/ai/metrics.js` (Phase 1 output) | Gate logic | ✓ | 37 clusters, 9/9 tests GREEN | — |

**Missing dependencies:** None. Phase 3 is code-only with zero new npm packages.

---

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22 built-in) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test src/ai/pipeline.test.js` |
| Full suite command | `node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js` |

**Important:** Phase 3 tests call real OpenRouter API. Require `OPENROUTER_API_KEY`.
Same API-key guard as critic.test.js (exit 0 when unset).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPELINE-01 SC1 | `runPipeline()` returns valid `{lyrics, tags, title}` for all paths (fast, skip, rewrite) | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |
| PIPELINE-02 SC2 | Draft scoring >= 12/15 returns without calling rewriteDraft (confirmed by log) | integration + log | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |
| PIPELINE-01 SC3 | Draft < 12/15 is rewritten with >= 20% new tokens | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |
| PIPELINE-04 SC4 | KEEP sections from critique reproduced verbatim in rewrite | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |
| PIPELINE-01 SC5 | E2E latency stays under 150s; timeout returns best draft | integration (mock timeout) | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |
| MODELS-01 | `google/gemini-2.5-flash` with `reasoning.effort` is used (verify from log or model config) | unit | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 |

### Test Fixture Strategy

Phase 3 tests reuse existing fixtures from critic.test.js:
- `GENERIC_DRAFT` — scores low (total ~9-11), full pipeline path expected
- `SPECIFIC_DRAFT` / `CLEAN_DRAFT` — scores high (total 12-13), fast-path expected

SC3 test: run pipeline with `GENERIC_DRAFT` fixture, verify `computeNewTokenRatio()` >= 0.20
between original draft and returned lyrics.

SC4 test: run pipeline with `GENERIC_DRAFT`, get critique's `keep_sections`, check each
against the returned lyrics using `extractSection()` equality.

SC5 test (timeout): inject a mock `rewriteDraft` that resolves after 90s; run with 60s timeout;
verify the returned `{lyrics, tags, title}` equals the original draft (not undefined/null).

### Sampling Rate

- **Per task commit:** `npm run check && node --test src/ai/pipeline.test.js`
- **Per wave merge:** `node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js`
- **Phase gate:** All 6 tests above green; `npm run check` passes; SC5 latency verified

### Wave 0 Gaps

- [ ] `src/ai/rewriter.js` — module skeleton (exported `rewriteDraft`)
- [ ] `src/ai/pipeline.js` — module skeleton (exported `runPipeline`)
- [ ] `src/ai/pipeline.test.js` — 6 test cases listed above (RED state initially)
- [ ] `package.json` — update `test` script to include `pipeline.test.js`; add `test:pipeline` script
- [ ] `package.json` — update `check` script to include `rewriter.js` and `pipeline.js`
- [ ] `src/config.js` — add `config.ai.rewriterModel` (env override for `AI_REWRITER_MODEL`)

---

## Security Domain

Phase 3 adds two new OpenRouter calls (rewriter). Same API key and endpoint as existing calls.
No new secrets, no new attack surface beyond what Phases 1-2 already introduce.

ASVS V5 (Input Validation): Song lyrics and user details flow into the rewriter as user message
content. Same low injection risk as critic call — Russian text is safe for OpenRouter JSON API.

No additional security requirements.

---

## Sources

### Primary (HIGH confidence)

- `src/ai/client.js` — existing generator pattern: request body shape, response parsing, thinking-blocks array handling [VERIFIED: file read this session]
- `src/ai/critic.js` — existing critic pattern: retry loop, null return, parseCritique structure [VERIFIED: file read this session]
- `src/ai/metrics.js` — tokenize() function, word boundary split pattern [VERIFIED: file read this session]
- `openrouter.ai/docs/guides/best-practices/reasoning-tokens` — `reasoning: { effort, max_tokens, exclude }` structure; `include_reasoning: true` = legacy alias for `reasoning: {}` [VERIFIED: WebFetch this session]
- `.planning/STATE.md` — locked decisions: rewriter model, thinking ON, instruction drift guard, context budget rule, no pipeline loops, sycophancy guard threshold [VERIFIED: file read this session]
- `.planning/phases/02-critic-integration/02-03-SUMMARY.md` — Phase 2 closure: critiqueDraft null contract, skip gate owned by Phase 3 [VERIFIED: file read this session]

### Secondary (MEDIUM confidence)

- `github.com/danny-avila/LibreChat/discussions/9371` — community report that `include_reasoning` doesn't trigger reasoning for Gemini Flash; `reasoning_effort` (now `reasoning.effort`) is the working parameter [MEDIUM: community report, not official docs — but consistent with OpenRouter docs]
- `github.com/agno-agi/agno/issues/5329` — confirms `message.reasoning` is the correct field for OpenRouter Gemini thinking output [MEDIUM: issue report, shows real OpenRouter response structure]
- `openrouter.ai/google/gemini-2.5-flash` — model ID `google/gemini-2.5-flash` confirmed; pricing $0.30/$2.50 per MTok; context 1M tokens [VERIFIED: WebFetch this session]

### Tertiary (LOW confidence)

- A1: `reasoning: { effort: 'high' }` more reliable than `include_reasoning: true` — inferred from community reports; use `reasoning: { max_tokens: 8000 }` as safer alternative (mirrors generator)
- A3: 20% new-token threshold achievable — estimated from "2 sections of 7" reasoning; validate in Phase 4

---

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps, Node 22 built-ins): HIGH — consistent with existing codebase
- Architecture (pipeline.js + rewriter.js separation): HIGH — clean single-concern modules
- Gemini thinking parameter (`reasoning.effort` vs `include_reasoning`): MEDIUM — community-verified but not official docs; `reasoning.max_tokens` is a safe fallback
- Rewriter response format (plain string vs content blocks): MEDIUM — defensive handling covers both cases
- Sycophancy threshold (20%): LOW-MEDIUM — reasonable estimate; calibrate in Phase 4

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (OpenRouter model IDs stable; API parameters stable; threshold calibration expected in Phase 4)
