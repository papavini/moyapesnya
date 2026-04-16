---
phase: 01-programmatic-metrics-gate
plan: "02"
subsystem: ai/metrics
tags: [metrics, tdd, green, banale, syllable, mattr, gate]
dependency_graph:
  requires: ["01-01"]
  provides: ["scoreDraft gate function", "METRICS-01", "METRICS-02", "METRICS-04"]
  affects: ["src/ai/client.js (Plan 01-03)"]
tech_stack:
  added: []
  patterns: ["pure function module", "cluster lookup Map", "sliding window TTR"]
key_files:
  created: []
  modified:
    - src/ai/metrics.js
decisions:
  - "37 clusters (well above >=28 floor) — use full list from RESEARCH.md verbatim"
  - "ё/Ё listed explicitly in both RUSSIAN_VOWELS and WORD_BOUNDARY — [а-я] range misses ё in JS"
  - "Repeated Припев blocks: keep first occurrence only (word-for-word identical in SUNO structure)"
  - "MATTR TTR fallback when tokens.length < 50 (short inputs like empty string)"
metrics:
  duration: "~5 min"
  completed: "2026-04-16"
  tasks_completed: 1
  files_changed: 1
---

# Phase 1 Plan 02: Metrics Gate Implementation Summary

## One-liner

Synchronous quality gate with 37-cluster banale detector, chorus syllable checker (vowel regex + ё fix), and MATTR-approx sliding window — all 9 tests GREEN.

## What was built

Full replacement of the Plan 01 skeleton body in `src/ai/metrics.js` (270 lines).
Single exported function `scoreDraft(lyrics)` backed by seven internal helpers.

### Cluster count

**37 cluster groups** — well above the METRICS-01 requirement of >=28.

### Test output (TAP excerpt)

```
▶ banale detection (METRICS-01)
  ✔ detects любовь/кровь pair from canonical cluster (1.7ms)
  ✔ detects розы/слёзы from morose cluster (0.3ms)
✔ banale detection (METRICS-01) (2.9ms)
▶ syllable violations (METRICS-02)
  ✔ flags chorus line over 12 syllables (0.3ms)
  ✔ does not flag chorus line at exactly 12 syllables (0.3ms)
✔ syllable violations (METRICS-02) (0.8ms)
▶ lexical diversity / MATTR (METRICS-04)
  ✔ repetitive text scores below 0.60 (0.4ms)
  ✔ varied text scores at or above 0.60 (1.1ms)
✔ lexical diversity / MATTR (METRICS-04) (1.7ms)
▶ skip_pipeline gate
  ✔ returns shape-correct object on any input (smoke test) (0.9ms)
  ✔ returns skip_pipeline=true for clean varied draft (0.4ms)
  ✔ returns skip_pipeline=false when banale pair found (0.2ms)
✔ skip_pipeline gate (1.8ms)
ℹ tests 9
ℹ suites 4
ℹ pass 9
ℹ fail 0
```

### Line count

`src/ai/metrics.js`: **270 lines** (min_lines requirement: 130 — satisfied)

### Functional probe: любовь/кровь → banale_pairs non-empty

```
Input: '[Куплет 1]\nЯ пишу про любовь\nстучит кровь'
Output: { banale_pairs: [["любовь","кровь"]], syllable_violations: [], lexical_diversity: 0.5, skip_pipeline: false }
```

### Functional probe: chorus syllable violation

```
Input: '[Припев]\nрадиоактивный город заснял один фотограф у моря'
Output: syllable_violations[0].count = 18  (> 12 → flagged)
```

## Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement metrics.js algorithms | 607c612 | src/ai/metrics.js |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `scoreDraft` is fully implemented. The skeleton placeholder body was completely replaced.

## TDD Gate Compliance

Plan type is `tdd`. Gate sequence:
- RED state: confirmed in Plan 01 (commit 2aea5c7) — stub returned empty arrays / 0
- GREEN state: this plan (commit 607c612) — all 9 tests pass

Both RED and GREEN gates satisfied.

## Self-Check: PASSED

- `src/ai/metrics.js` exists: FOUND
- Commit 607c612 exists: FOUND
- `node --check src/ai/metrics.js`: exits 0
- `node --test src/ai/metrics.test.js`: 9 pass, 0 fail
- clusters: 37 (>= 28 required)
- `grep BANNED_RHYME_CLUSTERS`: 1 match
- `grep export function scoreDraft`: 1 match
- `grep export default`: 0 matches
- `grep ^import`: 0 matches
- `grep async function|await`: 0 matches
- `grep console.`: 0 matches
