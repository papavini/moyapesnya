---
phase: 01-programmatic-metrics-gate
plan: "03"
subsystem: ai-pipeline
tags: [metrics, integration, ai-client, package-scripts]
dependency_graph:
  requires: ["01-02"]
  provides: ["scoreDraft integrated into generateLyrics", "npm test script"]
  affects: ["src/ai/client.js", "package.json"]
tech_stack:
  added: []
  patterns: ["synchronous gate inline with generation", "node:test built-in test runner"]
key_files:
  modified:
    - src/ai/client.js
    - package.json
decisions:
  - "metrics returned on generateLyrics response (backward-compatible extra key)"
  - "check script extended to cover both new ai/ files"
metrics:
  duration: "~5 min"
  completed: "2026-04-16"
  tasks: 2
  files: 2
---

# Phase 01 Plan 03: Wire scoreDraft into generateLyrics — Summary

**One-liner:** Wired synchronous `scoreDraft` gate into `generateLyrics()` return value; added `npm test` script backed by `node:test` built-in; no new dependencies.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wire scoreDraft into generateLyrics() | 90c1715 | src/ai/client.js |
| 2 | Add test and test:metrics scripts to package.json | 90c1715 | package.json |

## Exact Diff Applied — src/ai/client.js

### Edit 1: Add import (after line 2)

**Before:**
```js
// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';
```

**After:**
```js
// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';
import { scoreDraft } from './metrics.js';
```

### Edit 2: Wire scoreDraft + add metrics to return value (end of generateLyrics)

**Before (lines 335-340):**
```js
  console.log('[ai] tags:', tags);

  const title = extractTitle(lyrics, occasion, wishes);

  return { lyrics, tags, title };
}
```

**After:**
```js
  console.log('[ai] tags:', tags);

  const title = extractTitle(lyrics, occasion, wishes);

  const metrics = scoreDraft(lyrics);
  console.log('[ai] metrics:', JSON.stringify(metrics));
  return { lyrics, tags, title, metrics };
}
```

## New package.json Scripts

**Before:**
```json
"scripts": {
  "start": "node src/index.js",
  "start:tg": "node src/index.js --only=telegram",
  "start:vk": "node src/index.js --only=vk",
  "check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js"
},
```

**After:**
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

## Verification Output

### npm run check

```
> suno-sales-bot@0.1.0 check
> node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js && node --check src/ai/client.js && node --check src/ai/metrics.js

(exit 0 — no output means all files pass syntax check)
```

### npm test

```
> suno-sales-bot@0.1.0 test
> node --test src/ai/metrics.test.js

▶ banale detection (METRICS-01)
  ✔ detects любовь/кровь pair from canonical cluster (1.2654ms)
  ✔ detects розы/слёзы from morose cluster (0.1832ms)
✔ banale detection (METRICS-01) (2.3134ms)
▶ syllable violations (METRICS-02)
  ✔ flags chorus line over 12 syllables (0.2867ms)
  ✔ does not flag chorus line at exactly 12 syllables (0.2491ms)
✔ syllable violations (METRICS-02) (0.7034ms)
▶ lexical diversity / MATTR (METRICS-04)
  ✔ repetitive text scores below 0.60 (0.3273ms)
  ✔ varied text scores at or above 0.60 (1.0305ms)
✔ lexical diversity / MATTR (METRICS-04) (1.5336ms)
▶ skip_pipeline gate
  ✔ returns shape-correct object on any input (smoke test) (0.9425ms)
  ✔ returns skip_pipeline=true for clean varied draft (0.3617ms)
  ✔ returns skip_pipeline=false when banale pair found (0.262ms)
✔ skip_pipeline gate (1.7669ms)
ℹ tests 9
ℹ suites 4
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 97.2561
```

## src/flow/generate.js — Unchanged (backward compatibility confirmed)

`git diff src/flow/generate.js` produced empty output. The file is byte-identical to its pre-Phase-1 state.

`src/flow/generate.js` calls `generateCustom`/`generateByDescription` from `src/suno/client.js` directly — it does not call `generateLyrics()`. The extra `metrics` key on `generateLyrics()` return is ignored by all existing callers in `src/bots/telegram.js` that destructure only `{lyrics, tags, title}`.

## Deviations from Plan

None — plan executed exactly as written. Both surgical edits applied precisely as specified in the integration_pattern section.

## Phase 1 Status

**Phase 1 is complete and ready for ROADMAP update and Phase 2 planning.**

All three Phase 1 deliverables are committed and green:
- **Plan 01-01** (commit 2aea5c7): `src/ai/metrics.js` skeleton + `src/ai/metrics.test.js` (9 cases, RED state)
- **Plan 01-02** (commit 607c612): `src/ai/metrics.js` full implementation — 37 clusters, syllable checker, MATTR-approx, scoreDraft gate. All 9 tests GREEN.
- **Plan 01-03** (commit 90c1715): `scoreDraft` wired into `generateLyrics()` return; `npm test` script added.

Requirements covered: METRICS-01, METRICS-02, METRICS-04.
Phase 2 (Critic integration — Claude Sonnet 4.6 cross-model critique) can begin.

## Self-Check: PASSED

- `src/ai/client.js` modified and committed: FOUND (90c1715)
- `package.json` modified and committed: FOUND (90c1715)
- `npm run check` exits 0: CONFIRMED
- `npm test` exits 0 (9/9 pass): CONFIRMED
- `src/flow/generate.js` unchanged: CONFIRMED (empty git diff)
- `import { scoreDraft }` present in client.js: count=1
- `scoreDraft(lyrics)` call present: count=1
- `return { lyrics, tags, title, metrics }` present: count=1
- old `return { lyrics, tags, title }` removed: count=0
