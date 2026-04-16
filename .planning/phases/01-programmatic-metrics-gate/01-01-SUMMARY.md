---
phase: 01-programmatic-metrics-gate
plan: "01"
subsystem: ai/metrics
tags: [tdd, metrics, skeleton, red-state]
dependency_graph:
  requires: []
  provides: [src/ai/metrics.js, src/ai/metrics.test.js]
  affects: [src/ai/client.js]
tech_stack:
  added: []
  patterns: [node:test built-in, ESM named export, pure function no deps]
key_files:
  created:
    - src/ai/metrics.js
    - src/ai/metrics.test.js
  modified: []
decisions:
  - scoreDraft returns shape-correct placeholder; no real algorithm yet (Plan 02 fills GREEN)
  - node:test built-in used — no devDependency needed
  - Tests co-located with source (src/ai/) per VALIDATION.md authority
metrics:
  duration_sec: 87
  completed: "2026-04-16T12:12:29Z"
  tasks_completed: 2
  files_created: 2
requirements:
  - METRICS-01
  - METRICS-02
  - METRICS-04
---

# Phase 1 Plan 01: Metrics Module Skeleton + Failing Test Suite (RED State TDD) Summary

**One-liner:** Stub `scoreDraft()` with shape-correct placeholder return and 9-case failing test suite covering banale, syllable, MATTR, and gate dimensions — RED state TDD Wave 1 complete.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/ai/metrics.js` | 27 | `scoreDraft()` skeleton — named export, JSDoc, Russian header comment, returns `{banale_pairs:[], syllable_violations:[], lexical_diversity:0, skip_pipeline:false}` |
| `src/ai/metrics.test.js` | 144 | Failing test suite — 4 describe blocks, 9 it() cases, uses `node:test` + `node:assert/strict` |

## Test Suite Structure

| Describe Block | it() Cases | METRICS Req |
|----------------|------------|-------------|
| `banale detection (METRICS-01)` | 2 | METRICS-01 |
| `syllable violations (METRICS-02)` | 2 | METRICS-02 |
| `lexical diversity / MATTR (METRICS-04)` | 2 | METRICS-04 |
| `skip_pipeline gate` | 3 | gate logic |
| **Total** | **9** | 3 requirements |

## RED State Proof

Running `node --test src/ai/metrics.test.js` exits with code **1** (non-zero). TAP output:

```
▶ banale detection (METRICS-01)
  ✖ detects любовь/кровь pair from canonical cluster (2.2718ms)
  ✖ detects розы/слёзы from morose cluster (0.2457ms)
✖ banale detection (METRICS-01) (3.3047ms)
▶ syllable violations (METRICS-02)
  ✖ flags chorus line over 12 syllables (0.221ms)
  ✔ does not flag chorus line at exactly 12 syllables (0.1439ms)
✖ syllable violations (METRICS-02) (0.5173ms)
▶ lexical diversity / MATTR (METRICS-04)
  ✔ repetitive text scores below 0.60 (0.2076ms)
  ✖ varied text scores at or above 0.60 (0.1447ms)
✖ lexical diversity / MATTR (METRICS-04) (0.477ms)
▶ skip_pipeline gate
  ✔ returns shape-correct object on any input (smoke test) (1.6831ms)
  ✖ returns skip_pipeline=true for clean varied draft (0.1927ms)
  ✔ returns skip_pipeline=false when banale pair found (0.1215ms)
✖ skip_pipeline gate (2.1946ms)
ℹ tests 9
ℹ suites 4
ℹ pass 4
ℹ fail 5
EXIT_CODE=1
```

**5 failures / 4 passes.** The 4 passing tests are shape/smoke tests that correctly validate the stub contract (correct return shape, empty arrays, false). The 5 failures are all implementation-dependent assertions that require the real algorithms from Plan 02.

## Verification: node --check

Both files pass syntax validation:
- `node --check src/ai/metrics.js` → exit 0
- `node --check src/ai/metrics.test.js` → exit 0

## Commit

`2aea5c7` — `feat: Phase 1 Wave 1 — metrics.js skeleton + failing test suite (RED state TDD)`

## Plan 02 Readiness Confirmation

Plan 02 can begin implementation immediately:

1. `src/ai/metrics.test.js` exists with concrete assertions — Plan 02 has a `<verify>` command on every task
2. The test suite runs and exits non-zero — every task in Plan 02 has a clear pass/fail signal
3. The four describe blocks match the four implementation tasks in Plan 02 (METRICS-01 banale → METRICS-02 syllables → METRICS-04 MATTR → gate)
4. No new dependencies required — `node:test` is built-in to Node 22

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `src/ai/metrics.js` exists: FOUND
- `src/ai/metrics.test.js` exists: FOUND
- Commit `2aea5c7` exists: FOUND
- `node --check` passes both files: CONFIRMED
- `node --test` exits non-zero (RED): CONFIRMED (exit code 1, 5 failures)
- 4 describe blocks: CONFIRMED
- 9 it() cases (>= 7 required): CONFIRMED
