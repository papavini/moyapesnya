# Phase 1: Programmatic Metrics Gate — Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 2 (1 new module, 1 new test file)
**Analogs found:** 2 / 2

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ai/metrics.js` | utility (pure computation module) | transform | `src/access-codes.js` | role-match |
| `tests/metrics.test.js` | test | — | none (no test files exist) | no-analog |
| `src/ai/client.js` (modify: add import + call) | service | request-response | self (existing) | exact |

---

## Pattern Assignments

### `src/ai/metrics.js` (utility, transform)

**Primary analog:** `src/access-codes.js`
**Secondary analog:** `src/queue.js`

Both analogs are pure computation modules: no external I/O, no network calls, module-level data structures, named exports only, JSDoc on every export, `[module]` tag prefix in any logs. `src/access-codes.js` is the closest match because it uses a module-level constant Map for lookups — identical to `wordToCluster` in metrics. `src/queue.js` is useful as an additional pattern source for module-level mutable state.

**Imports pattern** — `src/access-codes.js` lines 1-0 (no imports needed):

```js
// src/access-codes.js has zero imports — pure in-memory module
// metrics.js will also have zero imports (pure Node.js, no built-ins needed)
// If a built-in were needed, the pattern from src/config.js shows it comes last:
import 'dotenv/config';          // external first
import { config } from './config.js';  // internal second
// node built-ins (e.g. import { createHash } from 'crypto') come last
```

**Module-level constant data structure pattern** — `src/access-codes.js` lines 12-33:

```js
// SCREAMING_SNAKE_CASE for truly fixed module-level constants
const CODES = {
  '482916': null,
  '735024': null,
  // ...
};
```

Apply to `src/ai/metrics.js` as:

```js
// SCREAMING_SNAKE_CASE for fixed banale cluster data
const BANNED_RHYME_CLUSTERS = [
  ['любовь', 'вновь', 'кровь'],
  // ...
];

// Derived Map from the constant — module-level, built once
const wordToCluster = new Map();
BANNED_RHYME_CLUSTERS.forEach((cluster, idx) => {
  cluster.forEach(word => wordToCluster.set(word, idx));
});
```

**Named exports pattern (no default exports)** — `src/access-codes.js` lines 39-68 and `src/queue.js` lines 13-54:

```js
// Named exports throughout — never `export default`
export function checkAndUseCode(code, userId) { ... }
export function isUserVerified(userId) { ... }
export function getCodesStatus() { ... }

// src/queue.js same pattern:
export function getQueueLength() { ... }
export function isGenerating() { ... }
export function enqueue(fn) { ... }
```

Apply to `src/ai/metrics.js` as:

```js
export function scoreDraft(lyrics) { ... }
// Internal helpers are NOT exported (no export keyword):
function parseSections(lyrics) { ... }
function countSyllables(line) { ... }
function findChorusSyllableViolations(sections) { ... }
function findBanalePairs(sections) { ... }
function tokenize(text) { ... }
function computeMATTR(tokens, windowSize = 50) { ... }
```

**JSDoc comment pattern** — `src/access-codes.js` lines 36-38 and `src/queue.js` lines 13-15:

```js
/**
 * Проверяет код и привязывает к userId.
 * @returns {'ok' | 'invalid' | 'used'}
 */
export function checkAndUseCode(code, userId) {

/**
 * Добавляет fn в очередь, возвращает Promise с результатом когда дойдёт очередь.
 */
export function enqueue(fn) {
```

Apply to `src/ai/metrics.js` — the single exported function:

```js
/**
 * Оценивает черновик текста песни по трём метрикам качества.
 * Синхронная, без I/O, без зависимостей.
 *
 * @param {string} lyrics - полный текст с секциями [Куплет 1], [Припев] и т.д.
 * @returns {{ banale_pairs: string[][], syllable_violations: object[], lexical_diversity: number, skip_pipeline: boolean }}
 */
export function scoreDraft(lyrics) {
```

**File-level comment pattern** — `src/store.js` lines 1-3 and `src/suno/client.js` file header:

```js
// Очень простой in-memory store состояния пользователя.
// Для прод-версии заменить на Redis / SQLite.

// Клиент к self-hosted gcui-art/suno-api.
// Ожидаемые эндпоинты (проверь README suno-api — они меняются от версии):
```

Apply to `src/ai/metrics.js`:

```js
// Синхронный gate-модуль для оценки качества черновика текста песни.
// Три метрики: банальные рифмы (lookup по кластерам), слоговые нарушения (regex),
// лексическое разнообразие (MATTR-approx, скользящее окно 50 токенов).
// Нет зависимостей, нет I/O, нет API-вызовов.
```

**Logging pattern** — `src/access-codes.js` line 46 and `src/ai/client.js` lines 289, 335:

```js
console.log(`[access] код ${c} активирован пользователем ${userId}`);
console.log(`[ai] attempt ${attempt}: HTTP ${res.status}`);
console.log('[ai] tags:', tags);
```

Apply to `src/ai/metrics.js` — metrics is called inside `generateLyrics` in `src/ai/client.js`, so logging goes in the caller, not metrics itself. However if metrics needs debug logging (e.g. pitfall warnings):

```js
// Log only in the caller (src/ai/client.js):
console.log('[ai] metrics:', JSON.stringify(metrics));
// In metrics.js itself: no console calls (pure computation, no side effects)
```

**Structured return object pattern** — `src/flow/generate.js` lines 30-31, 63-64, 91-92:

```js
return { ok: false, error: 'Сервер временно недоступен.' };
return { ok: true, clips: toSend, allClips: clips };
```

Apply to `src/ai/metrics.js` — `scoreDraft` returns a structured result (not ok/error but same flat-object convention):

```js
return {
  banale_pairs: banalePairs,
  syllable_violations: syllableViolations,
  lexical_diversity: Math.round(lexicalDiversity * 1000) / 1000,
  skip_pipeline: skipPipeline,
};
```

**Module-level state variable pattern** — `src/queue.js` lines 7-8 and `src/store.js` lines 4-7:

```js
const jobs = [];
let running = false;

const sessions = new Map();
const payments = new Map();
const DEFAULT = () => ({ state: 'idle', data: {} });
```

Apply to module-level constants in `src/ai/metrics.js` — the BANNED_RHYME_CLUSTERS array and derived wordToCluster Map follow this exact pattern.

---

### `src/ai/client.js` — modification (add import + call)

**This is an existing file being modified, not created.** Pattern: add one import line at top and one call inside `generateLyrics()`.

**Import addition pattern** — `src/flow/generate.js` lines 5-11:

```js
import {
  generateByDescription,
  generateCustom,
  waitForClips,
  ensureTokenAlive,
} from '../suno/client.js';
import { config } from '../config.js';
```

Add to top of `src/ai/client.js` (after existing `import { config }` line):

```js
import { scoreDraft } from './metrics.js';
```

**Integration point** — `src/ai/client.js` lines 325-339 (inside `generateLyrics`, before `return`):

Current ending:
```js
  const title = extractTitle(lyrics, occasion, wishes);

  return { lyrics, tags, title };
}
```

Modified ending:
```js
  const title = extractTitle(lyrics, occasion, wishes);

  const metrics = scoreDraft(lyrics);
  console.log('[ai] metrics:', JSON.stringify(metrics));
  return { lyrics, tags, title, metrics };
}
```

This is backward-compatible: callers in `src/flow/generate.js` destructure `{ lyrics, tags, title }` only — extra `metrics` key is ignored.

---

### `tests/metrics.test.js` (test)

**No analog exists** — the project has zero automated test files. See "No Analog Found" section.

**Recommended pattern** — based on `node:test` Node 22 built-in, per TESTING.md and RESEARCH.md:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDraft } from '../src/ai/metrics.js';
```

**Naming convention for test file placement** — per TESTING.md, no `tests/` directory exists. Create it at project root (`tests/`) following Node.js convention. File name follows project `camelCase.js` convention: `metrics.test.js`.

---

## Shared Patterns

### Named Exports (no defaults)
**Source:** Every file in `src/` — `src/access-codes.js`, `src/queue.js`, `src/store.js`, `src/ai/client.js`
**Apply to:** `src/ai/metrics.js`
**Pattern:** `export function name()` — never `export default`. All helpers are unexported plain functions.

### Module-level Constants in SCREAMING_SNAKE_CASE
**Source:** `src/access-codes.js` (CODES), `src/ai/client.js` (SYSTEM_PROMPT), `src/config.js` (no SCREAMING but pattern shows intent)
**Apply to:** `src/ai/metrics.js`
**Excerpt** — `src/access-codes.js` lines 12-33:
```js
const CODES = {
  '482916': null,
  // ...
};
```
In metrics: `BANNED_RHYME_CLUSTERS`, `RUSSIAN_VOWELS`, `WORD_BOUNDARY`, `SKIP_PIPELINE_THRESHOLD`, `MAX_CHORUS_SYLLABLES` are all module-level constants.

### Log Tag Prefix `[module]`
**Source:** All `src/` files — `[ai]`, `[suno]`, `[telegram]`, `[access]`, `[generate]`
**Apply to:** logging in `src/ai/client.js` integration point (not in metrics.js itself, which is pure computation)
```js
console.log('[ai] metrics:', JSON.stringify(metrics));
```

### 2-space indentation, single quotes, semicolons
**Source:** All `src/` files (CONVENTIONS.md §Code Style)
**Apply to:** Both `src/ai/metrics.js` and `tests/metrics.test.js`
```js
// 2-space indent:
function parseSections(lyrics) {
  const sections = {};
  let currentTag = null;
  let currentLines = [];
  // ...
}
```

### JSDoc on every exported function
**Source:** `src/access-codes.js` lines 36-38, `src/queue.js` lines 13-15, 20-22, 27-30, 33-35
**Apply to:** `scoreDraft()` export in `src/ai/metrics.js`

### File-level algorithm comment
**Source:** `src/store.js` lines 1-3, `src/suno/client.js` file header
**Apply to:** Top of `src/ai/metrics.js` — 3-4 line comment describing module purpose and what it does NOT do (no deps, no I/O).

### `.js` extension in all relative imports (ESM requirement)
**Source:** All `src/` files (CONVENTIONS.md §Language)
**Apply to:** `import { scoreDraft } from './metrics.js'` (not `./metrics`)

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/metrics.test.js` | test | — | Zero test files exist in project. No `tests/` directory exists. Use `node:test` built-in as shown in RESEARCH.md Pattern 6 test structure. |

---

## Key Observations for Planner

1. **`src/ai/metrics.js` closest analog is `src/access-codes.js`**: same pattern — module-level constant data structure (Map), named exports, zero dependencies, zero I/O, pure computation, JSDoc on exports.

2. **No test infrastructure exists**: creating `tests/metrics.test.js` requires creating the `tests/` directory first. The `package.json` `check` script does not include the new file — planner should add `node --test tests/metrics.test.js` as a separate step or add a `test` script to `package.json`.

3. **Integration into `client.js` is one import line + two lines in `generateLyrics`**: non-invasive, backward-compatible. The return value change (`+ metrics`) requires no changes in `src/flow/generate.js`.

4. **SCREAMING_SNAKE_CASE applies to all module-level fixed constants** in metrics.js: cluster array, regex literals, numeric thresholds. Module-level derived state (the `wordToCluster` Map) uses camelCase because it is derived, not literally a constant.

5. **Russian in comments, English in names**: all variable and function names are English camelCase; all JSDoc descriptions, inline comments, and log strings are in Russian. This is the project-wide convention.

---

## Metadata

**Analog search scope:** `src/` (all 14 `.js` files), `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/TESTING.md`
**Files scanned:** 14 source files + 2 planning docs
**Pattern extraction date:** 2026-04-16
