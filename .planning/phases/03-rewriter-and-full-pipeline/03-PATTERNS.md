# Phase 3: Rewriter and Full Pipeline — Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ai/rewriter.js` | service | request-response | `src/ai/critic.js` | exact (same: retry loop, null return, fetch, array content guard, JSON parse) |
| `src/ai/pipeline.js` | service / orchestrator | request-response | `src/flow/generate.js` + `src/ai/metrics.js` | role-match (orchestration + pure-function gate logic) |
| `src/ai/pipeline.test.js` | test | request-response | `src/ai/critic.test.js` | exact (same: API-key guard, node:test, describe/it, real OpenRouter fixtures) |
| `src/config.js` | config | — | `src/config.js` lines 27-32 | exact (ai section, env override pattern) |
| `src/bots/telegram.js` | bot | request-response | `src/bots/telegram.js` lines 6, 258-259, 499 | exact (single import swap + two call-site swaps) |
| `package.json` | config | — | `package.json` lines 11-14 | exact (scripts.check and scripts.test extension) |

---

## Pattern Assignments

### `src/ai/rewriter.js` (service, request-response)

**Analog:** `src/ai/critic.js`

**Imports pattern** (`src/ai/critic.js` lines 1-10):
```js
import { config } from '../config.js';

const CRITIC_MODEL = process.env.AI_CRITIC_MODEL || config.ai.criticModel || 'anthropic/claude-sonnet-4.6';
```
Rewriter equivalent — use `config.ai.rewriterModel` (new field added in config.js):
```js
import { config } from '../config.js';

const REWRITER_MODEL = config.ai.rewriterModel || 'google/gemini-2.5-flash';
```

**API call pattern — fetch body** (`src/ai/critic.js` lines 164-172, critiqueDraft body):
```js
const body = {
  model: CRITIC_MODEL,
  messages: [
    { role: 'system', content: CRITIC_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ],
  response_format: { type: 'json_object' },
  max_tokens: 2000,
  temperature: 0.2,
  // reasoning: OMITTED for critic
};
```
Rewriter difference — adds `reasoning`, omits `response_format` (may not be compatible with reasoning ON):
```js
const body = {
  model: REWRITER_MODEL,
  messages: [
    { role: 'system', content: REWRITER_SYSTEM_PROMPT },
    { role: 'user', content: buildRewriterUserMessage(lyrics, critique) },
  ],
  max_tokens: 16000,
  temperature: 0.9,
  reasoning: { max_tokens: 8000 },  // same as client.js generator; thinking ON
  // response_format: OMITTED — JSON enforced via system prompt only
};
```

**Retry loop with null return** (`src/ai/critic.js` lines 264-304 — the critiqueDraft loop):
```js
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
    console.log(`[critic] attempt ${attempt}: ok total=${critique.total} keep=${critique.keep_sections.length}`);
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
```
Rewriter uses the same loop structure with 2 attempts and 2000ms delay. Replace `parseCritique` with inline JSON parse of `{lyrics}`.

**Array content guard** (`src/ai/critic.js` lines 203-208 and `src/ai/client.js` lines 305-308 — both identical):
```js
const content = data.choices?.[0]?.message?.content;
let raw;
if (Array.isArray(content)) {
  raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
} else {
  raw = (content || '').trim();
}
```
Copy verbatim — required guard for thinking mode (Gemini may return content-blocks array).

**Markdown strip + JSON parse** (`src/ai/client.js` lines 317-319 and `src/ai/critic.js` `parseCritique` line 123):
```js
const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
const parsed = JSON.parse(clean);
```

**API key guard** (`src/ai/critic.js` lines 161-163):
```js
if (!config.ai.apiKey) {
  throw new Error('OPENROUTER_API_KEY не задан');
}
```
Copy verbatim as first statement in `rewriteDraft()`.

**Success log pattern** (`src/ai/critic.js` line 292):
```js
console.log(`[critic] attempt ${attempt}: ok total=${critique.total} keep=${critique.keep_sections.length}`);
```
Rewriter equivalent:
```js
console.log(`[rewriter] attempt ${attempt}: ok, ${rewrittenLyrics.split('\n').length} lines`);
```

**Named export pattern** (all `src/ai/*.js` files):
```js
export async function rewriteDraft(lyrics, critique) { ... }
```

---

### `src/ai/pipeline.js` (orchestrator, request-response)

**Analog:** `src/flow/generate.js` (orchestration pattern) + `src/ai/metrics.js` (module-level constants, pure helpers)

**Imports pattern** — import all three pipeline modules:
```js
import { generateLyrics } from './client.js';
import { critiqueDraft } from './critic.js';
import { rewriteDraft } from './rewriter.js';
```
Analog from `src/flow/generate.js` lines 1-4:
```js
import { generateCustom, generateByDescription, waitForClips, ensureTokenAlive } from '../suno/client.js';
import { config } from '../config.js';
```

**Module-level constants pattern** (`src/ai/metrics.js` lines 13-19):
```js
const MAX_CHORUS_SYLLABLES = 12;
const MATTR_WINDOW = 50;
const SKIP_PIPELINE_THRESHOLD = 0.60;
```
Pipeline equivalent:
```js
const CRITIQUE_TIMEOUT_MS = 30_000;
const REWRITE_TIMEOUT_MS = 60_000;
const SKIP_GATE_SCORE = 12;
```

**Error return pattern — `{ ok: false, error }` vs best-available draft.** The pipeline follows `src/flow/generate.js` pattern of never throwing to the caller, but instead of `{ ok: false }` it returns the best-available `{lyrics, tags, title}`:
```js
// From src/flow/generate.js lines 32-39 (the catch-and-return pattern):
  } catch (e) {
    console.error('[generate] ошибка генерации:', e.message);
    return { ok: false, error: e.message };
  }
```
Pipeline adaptation — on step failure, return original draft (not error object), preserving the `generateLyrics` output contract:
```js
  } catch (e) {
    console.log('[pipeline] critique step failed:', e.message, '— using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }
```

**`Promise.race` timeout helper** — no direct analog in codebase; pattern from RESEARCH.md Pattern 7:
```js
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[pipeline] timeout: ${label} exceeded ${ms}ms`)), ms)
    ),
  ]);
}
```

**Tokenize helper** (`src/ai/metrics.js` lines 210-215 — copy and adapt for word-set diff):
```js
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .split(WORD_BOUNDARY)
    .filter(w => w.length >= 2);
}
```
Pipeline adaptation (inline word boundary, filter `>= 2`):
```js
function tokenizeForDiff(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .split(/[^а-яёa-z0-9]+/i)
    .filter(w => w.length >= 2);
}
```

**Named export pattern**:
```js
export async function runPipeline({ occasion, genre, mood, voice, wishes }) { ... }
```
Same destructured-params pattern as `generateLyrics` in `src/ai/client.js` line 254.

**Output contract** — every return path must produce the same shape as `generateLyrics` minus `metrics`:
```js
return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
// NOT: return draft;  // would leak metrics field
// NOT: return { ...draft };  // would leak metrics field
```

---

### `src/ai/pipeline.test.js` (test, request-response)

**Analog:** `src/ai/critic.test.js`

**API key guard** (`src/ai/critic.test.js` lines 8-11 — MUST appear before any imports that touch the module):
```js
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[critic.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}
```
Pipeline test equivalent:
```js
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[pipeline.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}
```

**Import block** (`src/ai/critic.test.js` lines 13-16):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judgeSpecificity, critiqueDraft } from './critic.js';
import { scoreDraft } from './metrics.js';
```
Pipeline test equivalent:
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './pipeline.js';
```

**Fixture reuse** (`src/ai/critic.test.js` lines 21-105):
Copy `GENERIC_DRAFT`, `SPECIFIC_DRAFT`, `CLEAN_DRAFT` verbatim from `critic.test.js`. They are inline in both files (no shared barrel — self-contained per file, same convention).

**Test structure** (`src/ai/critic.test.js` lines 115-188):
```js
describe('critiqueDraft (PIPELINE-03)', () => {
  it('returns valid JSON with all 5 dimensions present...', async () => {
    const metrics = scoreDraft(GENERIC_DRAFT);
    const critique = await critiqueDraft(GENERIC_DRAFT, metrics);
    assert.ok(critique !== null, '...');
    // ...
  });
});
```
Pipeline test describe blocks map to SCs:
- `describe('runPipeline — contract', ...)` → SC1
- `describe('runPipeline — fast path (skip gate)', ...)` → SC2
- `describe('runPipeline — rewrite path', ...)` → SC3
- `describe('runPipeline — KEEP sections verbatim', ...)` → SC4
- `describe('runPipeline — timeout fallback', ...)` → SC5

**Assertion patterns** (`src/ai/critic.test.js` lines 138-152):
```js
assert.ok(critique !== null, 'critiqueDraft must not return null on a well-formed draft');
assert.ok(typeof critique[dim]?.score === 'number', `${dim}.score must be a number...`);
assert.strictEqual(critique.total, expectedTotal, `...`);
```

---

### `src/config.js` extension (config)

**Analog:** `src/config.js` lines 27-32 (existing `ai` section)

**Existing ai section** (`src/config.js` lines 27-32):
```js
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4-5',
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    criticModel: process.env.AI_CRITIC_MODEL || 'anthropic/claude-sonnet-4.6',
  },
```
**Add one line** after `criticModel`:
```js
    rewriterModel: process.env.AI_REWRITER_MODEL || 'google/gemini-2.5-flash',
```
Result:
```js
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4-5',
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    criticModel: process.env.AI_CRITIC_MODEL || 'anthropic/claude-sonnet-4.6',
    rewriterModel: process.env.AI_REWRITER_MODEL || 'google/gemini-2.5-flash',
  },
```

---

### `src/bots/telegram.js` import swap (bot)

**Three exact change points:**

**Change 1 — import line 6** (replace import source, keep imported name the same to minimise diff):
```js
// BEFORE (line 6):
import { generateLyrics } from '../ai/client.js';

// AFTER:
import { runPipeline } from '../ai/pipeline.js';
```

**Change 2 — primary call site (lines 258-259)**:
```js
// BEFORE:
      console.log('[telegram] calling generateLyrics...');
      aiResult = await generateLyrics({ occasion, genre, mood, voice, wishes });

// AFTER:
      console.log('[telegram] calling runPipeline...');
      aiResult = await runPipeline({ occasion, genre, mood, voice, wishes });
```
The destructuring on line 260 `aiResult.lyrics?.substring(0, 50)` and the state set using `aiResult.lyrics`, `aiResult.tags`, `aiResult.title` are unchanged — `runPipeline` returns the same shape.

**Change 3 — editing_lyrics call site (lines 499-501)**:
```js
// BEFORE:
        const aiResult = await generateLyrics({
          occasion, genre, mood, voice,
          wishes: wishes + '\n\nПРАВКИ К ТЕКСТУ: ' + text + '\n\nПредыдущий текст:\n' + oldLyrics,
        });

// AFTER:
        const aiResult = await runPipeline({
          occasion, genre, mood, voice,
          wishes: wishes + '\n\nПРАВКИ К ТЕКСТУ: ' + text + '\n\nПредыдущий текст:\n' + oldLyrics,
        });
```

---

### `package.json` scripts extension (config)

**Existing scripts** (`package.json` lines 11-14):
```json
    "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js && node --check src/ai/critic.js",
    "test": "node --test src/ai/metrics.test.js src/ai/critic.test.js",
    "test:metrics": "node --test src/ai/metrics.test.js",
    "test:critic": "node --test src/ai/critic.test.js"
```

**After Phase 3 — add two files to `check`, one to `test`, add two new scripts**:
```json
    "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js && node --check src/ai/critic.js && node --check src/ai/rewriter.js && node --check src/ai/pipeline.js",
    "test": "node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js",
    "test:metrics": "node --test src/ai/metrics.test.js",
    "test:critic": "node --test src/ai/critic.test.js",
    "test:pipeline": "node --test src/ai/pipeline.test.js"
```

---

## Shared Patterns

### API key guard (apply to: `rewriter.js`, already in `critic.js` and `client.js`)
**Source:** `src/ai/critic.js` lines 161-163, `src/ai/client.js` lines 255-257
```js
if (!config.ai.apiKey) {
  throw new Error('OPENROUTER_API_KEY не задан');
}
```
Place as first statement of every exported async function that calls OpenRouter.

### Array content extraction guard (apply to: `rewriter.js` — thinking mode ON)
**Source:** `src/ai/critic.js` lines 203-208 (and identical at `src/ai/client.js` lines 305-308)
```js
const content = data.choices?.[0]?.message?.content;
let raw;
if (Array.isArray(content)) {
  raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
} else {
  raw = (content || '').trim();
}
```
Required for Gemini thinking mode — content may be returned as an array of typed blocks.

### Markdown strip before JSON parse (apply to: `rewriter.js`, already everywhere)
**Source:** `src/ai/critic.js` `parseCritique` line 123 / `src/ai/client.js` line 317
```js
const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
const parsed = JSON.parse(clean);
```

### Retry delay (apply to: `rewriter.js` — 2000ms; `critic.js` uses 1500ms)
**Source:** `src/ai/client.js` line 293 (2000ms), `src/ai/critic.js` line 299 (1500ms)
```js
await new Promise(r => setTimeout(r, 2000));
```
Rewriter uses 2000ms (same as generator) to match the thinking-mode response latency.

### Named exports, no default exports (apply to: all new `src/ai/*.js` files)
**Source:** every file in `src/ai/` — `export async function`, never `export default`
```js
export async function rewriteDraft(lyrics, critique) { ... }
export async function runPipeline({ occasion, genre, mood, voice, wishes }) { ... }
```

### Single-line log prefix convention (apply to: `rewriter.js`, `pipeline.js`)
**Source:** `src/ai/critic.js` lines 189, 292, 303 (`[critic]`), `src/ai/client.js` line 289 (`[ai]`)
```js
console.log(`[rewriter] attempt ${attempt}: ...`);
console.log('[pipeline] metrics gate: skip_pipeline=true — fast path');
```

---

## No Analog Found

All Phase 3 files have close analogs. No file requires falling back to RESEARCH.md patterns as primary source.

| File | Closest Analog | Note |
|------|----------------|-------|
| `withTimeout()` helper in `pipeline.js` | No direct analog | Pattern 7 in RESEARCH.md; simple `Promise.race` — no complex state needed |
| `computeNewTokenRatio()` in `pipeline.js` | `metrics.js` `tokenize()` (lines 210-215) | Derived pattern; word-set Jaccard; copy tokenize and adapt |
| `buildRewriterUserMessage()` in `rewriter.js` | `critic.js` `buildCriticUserMessage()` (lines 96-113) | Multi-line join pattern — same array `.join('\n')` style |

---

## Metadata

**Analog search scope:** `src/ai/`, `src/flow/`, `src/bots/`, `src/config.js`, `package.json`
**Files scanned:** 7
**Pattern extraction date:** 2026-04-16
