# Phase 2: Critic Integration — Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 4 (2 new, 2 modified)
**Analogs found:** 4 / 4

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/ai/critic.js` | service | request-response | `src/ai/client.js` | role-match (same OpenRouter pattern, different prompt) |
| `src/ai/critic.test.js` | test | — | `src/ai/metrics.test.js` | exact (same node:test framework, same describe/it style) |
| `src/config.js` | config | — | `src/config.js` (self) | exact (add field to `config.ai` block) |
| `package.json` | config | — | `package.json` (self) | exact (extend `scripts` block) |

---

## Pattern Assignments

### `src/ai/critic.js` (service, request-response)

**Analog:** `src/ai/client.js`

**File header comment pattern** (`src/ai/metrics.js` lines 1-4 — prefer this style for the new module):
```js
// Two-call LLM critic: specificity judge (METRICS-03) + 5-dimension critique (PIPELINE-03).
// Uses anthropic/claude-sonnet-4.6 via OpenRouter. No new dependencies.
// Синхронная валидация — parseCritique. Два async export: judgeSpecificity, critiqueDraft.
```

**Import pattern** (`src/ai/client.js` lines 1-3):
```js
// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';
```
Note: `critic.js` does NOT import `scoreDraft` — caller passes `metrics` as a parameter.

**Module-level constant** (model ID — hardcoded, never use `config.ai.model`):
```js
// [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6 — dot notation, released 2026-02-17]
// Note: dot notation is OpenRouter namespace; Anthropic API uses hyphens (claude-sonnet-4-6)
const CRITIC_MODEL = config.ai.criticModel || 'anthropic/claude-sonnet-4.6';
```

**Fetch call structure** (`src/ai/client.js` lines 270-286 — the exact pattern to copy, with three critical differences):
```js
res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.ai.apiKey}`,
  },
  body: JSON.stringify({
    model: CRITIC_MODEL,                        // NOT config.ai.model
    messages: [
      { role: 'system', content: CRITIC_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },   // NEW for critic — not in client.js
    max_tokens: 2000,                            // NOT 16000 — critic output is ~500-800 tokens
    temperature: 0.2,                            // NOT 1 — scoring needs consistency
    // reasoning: NOT set — omit entirely (unlike client.js which has reasoning: { max_tokens: 8000 })
  }),
});
```

**Retry loop pattern** (`src/ai/client.js` lines 268-295):
```js
let text, res;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    res = await fetch(/* ... */);
    text = await res.text();
    if (res.ok) break;
    console.log(`[ai] attempt ${attempt}: HTTP ${res.status}`);
  } catch (e) {
    console.log(`[ai] attempt ${attempt}: ${e.message}`);
    if (attempt === 3) throw e;
    await new Promise(r => setTimeout(r, 2000));
  }
}
```
Note: critic uses 2 attempts (not 3) and 1500ms delay. Apply this same loop shape but reduce `<= 3` to `<= 2` and `2000` to `1500`.

**Content extraction — thinking-block-safe pattern** (`src/ai/client.js` lines 302-308):
```js
const data = JSON.parse(text);
// thinking mode возвращает content как массив блоков [{type:'thinking',...},{type:'text',...}]
const content = data.choices?.[0]?.message?.content;
let raw;
if (Array.isArray(content)) {
  raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
} else {
  raw = (content || '').trim();
}
```
Copy this verbatim. Even though the critic does not enable reasoning, this defensive guard prevents breakage if `response_format: json_object` ever causes array-format content.

**JSON parsing and markdown-strip pattern** (`src/ai/client.js` lines 315-323):
```js
let parsed;
try {
  // Убираем возможные markdown-обёртки если модель всё равно добавила
  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  parsed = JSON.parse(clean);
} catch (e) {
  // Fallback or retry — critic uses retry, not raw-text fallback
  console.log('[critic] JSON parse failed:', e.message);
  throw e; // re-throw to trigger retry in the outer loop
}
```

**Error logging pattern** (`src/ai/client.js` line 289 and `src/ai/metrics.js` — use module prefix):
```js
console.log(`[critic] attempt ${attempt}: ${e.message}`);
console.log('[critic] specificity judge failed, using defaults:', e.message);
```

**Named export style** (project convention — no default exports, from `src/ai/metrics.js` line 254):
```js
export async function judgeSpecificity(lyrics) { /* ... */ }
export async function critiqueDraft(lyrics, metrics) { /* ... */ }
```

---

### `src/ai/critic.test.js` (test)

**Analog:** `src/ai/metrics.test.js`

**File header comment pattern** (`src/ai/metrics.test.js` lines 1-4):
```js
// Интеграционные тесты для src/ai/critic.js. Запуск: node --test src/ai/critic.test.js
// Покрытие: PIPELINE-03 (5-dimension critique), METRICS-03 (specificity judge),
// MODELS-02 (critic model identity).
// Требует OPENROUTER_API_KEY в .env — реальные API вызовы.
```

**API key guard** (must appear before imports that touch the module):
```js
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[critic.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}
```

**Import pattern** (`src/ai/metrics.test.js` lines 5-7):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judgeSpecificity, critiqueDraft } from './critic.js';
```
Also import `scoreDraft` from `./metrics.js` for the Fixture 3 (Phase 1 gate) test:
```js
import { scoreDraft } from './metrics.js';
```

**describe/it block style** (`src/ai/metrics.test.js` lines 37-63):
```js
describe('judgeSpecificity (METRICS-03)', () => {
  it('returns false/false for generic draft with no proper nouns or time', async () => {
    const result = await judgeSpecificity(GENERIC_DRAFT);
    assert.strictEqual(result.has_proper_nouns, false);
    assert.strictEqual(result.has_time_expressions, false);
  });
});
```

**Fixture constant style** (`src/ai/metrics.test.js` lines 9-35 — SCREAMING_SNAKE_CASE, join('\n'), placed before describe blocks):
```js
const GENERIC_DRAFT = [
  '[Куплет 1]',
  'Он встаёт по утрам и идёт на работу,',
  // ... lines
].join('\n');

const SPECIFIC_DRAFT = [
  '[Куплет 1]',
  'Шесть утра, а Рома уже шнурует кросс,',
  // ... lines
].join('\n');
```
Note: `CLEAN_DRAFT` from `metrics.test.js` can be re-used or redefined — it is the fixture for the "Phase 1 gate passing → critique.total >= 12" test (Fixture 3).

**assert style** (`src/ai/metrics.test.js` lines 45-49 — use `assert.ok` with message string):
```js
assert.ok(typeof result.story_specificity?.score === 'number',
  'story_specificity.score must be a number');
assert.ok(result.total >= 0 && result.total <= 15,
  `total must be 0-15, got ${result.total}`);
assert.ok(result.keep_sections.length >= 2,
  `keep_sections must have >= 2 entries, got ${JSON.stringify(result.keep_sections)}`);
```

---

### `src/config.js` — add `config.ai.criticModel` (MODIFY)

**Analog:** `src/config.js` itself

**Insertion point** (`src/config.js` lines 27-31 — `config.ai` block):
```js
// BEFORE (lines 27-31):
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4-5',
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  },

// AFTER — add criticModel as the 4th field in config.ai:
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4-5',
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
    criticModel: process.env.AI_CRITIC_MODEL || 'anthropic/claude-sonnet-4.6',
  },
```
Follow the existing pattern: `process.env.VAR_NAME || 'default'`. No helper functions needed (it is a string, not a bool or num). Place after `baseUrl` to keep generator fields together before the critic override.

---

### `package.json` — update test scripts (MODIFY)

**Analog:** `package.json` itself

**Current scripts block** (`package.json` lines 7-14):
```json
"scripts": {
  "start": "node src/index.js",
  "start:tg": "node src/index.js --only=telegram",
  "start:vk": "node src/index.js --only=vk",
  "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js",
  "test": "node --test src/ai/metrics.test.js",
  "test:metrics": "node --test src/ai/metrics.test.js"
},
```

**Target scripts block** (three changes: extend `test`, add `test:critic`, extend `check`):
```json
"scripts": {
  "start": "node src/index.js",
  "start:tg": "node src/index.js --only=telegram",
  "start:vk": "node src/index.js --only=vk",
  "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js && node --check src/ai/critic.js",
  "test": "node --test src/ai/metrics.test.js src/ai/critic.test.js",
  "test:metrics": "node --test src/ai/metrics.test.js",
  "test:critic": "node --test src/ai/critic.test.js"
},
```

---

## Shared Patterns

### OpenRouter HTTP Error Handling
**Source:** `src/ai/client.js` lines 297-299
**Apply to:** Both fetch calls in `critic.js` (judgeSpecificity and critiqueDraft main call)
```js
if (!res.ok) {
  throw new Error(`OpenRouter ${res.status}: ${text.substring(0, 200)}`);
}
```

### API Key Guard (module-level)
**Source:** `src/ai/client.js` lines 255-257 (function-level check)
**Apply to:** Both exported functions in `critic.js`
```js
if (!config.ai.apiKey) {
  throw new Error('OPENROUTER_API_KEY не задан');
}
```

### Delay Between Retries
**Source:** `src/ai/client.js` line 293
**Apply to:** Retry loop in `critiqueDraft`
```js
await new Promise(r => setTimeout(r, 1500));
```
Note: `client.js` uses 2000ms; critic uses 1500ms (tighter latency budget). Use 1500.

### Logging Prefix Convention
**Source:** `src/ai/client.js` line 289 (`[ai]` prefix)
**Apply to:** All `console.log` calls in `critic.js`
```js
// Pattern: '[modulename] message'
console.log(`[critic] attempt ${attempt}: HTTP ${res.status}`);
console.log('[critic] specificity judge failed, using defaults:', e.message);
```

### No Default Exports
**Source:** `src/ai/metrics.js` line 254, `src/ai/client.js` line 254
**Apply to:** `src/ai/critic.js`
```js
export async function judgeSpecificity(lyrics) { ... }
export async function critiqueDraft(lyrics, metrics) { ... }
// No: export default ...
```

---

## No Analog Found

No files in Phase 2 are without analog. All 4 files have clear existing patterns to follow.

---

## Key Deviations from Analog (`client.js`)

The following fields present in `client.js` MUST NOT be copied to `critic.js`:

| Field in client.js | Value | Do in critic.js instead |
|---|---|---|
| `model: config.ai.model` | dynamic from env | `model: CRITIC_MODEL` (constant, with optional env override via `config.ai.criticModel`) |
| `temperature: 1` | high — for creativity | `temperature: 0.2` — low, for scoring consistency |
| `max_tokens: 16000` | large — poem generation | `max_tokens: 2000` — critic JSON is ~500-800 tokens |
| `reasoning: { max_tokens: 8000 }` | thinking ON | omit entirely — no reasoning for critic |
| retry count `<= 3` | 3 attempts | `<= 2` — tighter latency budget |
| retry delay `2000` ms | 2s | `1500` ms |
| JSON parse fallback to raw text | `parsed = { lyrics: raw, tags: null }` | throw and retry — malformed critique is not usable |

---

## Metadata

**Analog search scope:** `src/ai/` (all files read)
**Files scanned:** `src/ai/client.js`, `src/ai/metrics.js`, `src/ai/metrics.test.js`, `src/config.js`, `package.json`
**Pattern extraction date:** 2026-04-16
