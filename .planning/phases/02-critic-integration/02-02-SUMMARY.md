---
phase: 02-critic-integration
plan: 02
subsystem: ai
tags: [openrouter, anthropic, critic, tdd, json-output, metrics]

# Dependency graph
requires:
  - phase: 02-critic-integration
    plan: 01
    provides: src/ai/critic.js Wave 1 skeleton with 6 RED tests
  - phase: 01-programmatic-metrics-gate
    provides: scoreDraft() metrics shape that critiqueDraft() accepts as parameter
provides:
  - src/ai/critic.js — full implementation of judgeSpecificity and critiqueDraft (305 lines)
affects: [02-03-PLAN, 03-rewriter-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "response_format: { type: 'json_object' } on critic/judge calls — guarantees parseable JSON without maintaining a full JSONSchema definition"
    - "parseCritique() validates and re-computes total via DIMS.reduce — never trusts model arithmetic (Pitfall 2 guard)"
    - "Non-fatal specificity fallback in critiqueDraft: judge call wrapped in try/catch, defaults to {false, false} on any failure"
    - "2-attempt retry loop with 1500ms backoff — deliberate deviation from client.js 3-attempt loop (critic callers abort faster on repeated failure)"
    - "Array.isArray(content) defensive content extraction — handles both plain string and thinking-block array responses (Pitfall 4 guard)"

key-files:
  modified:
    - src/ai/critic.js

key-decisions:
  - "Implemented both Task 1 (judgeSpecificity) and Task 2 (critiqueDraft) in a single write — both functions share helper constants (DIMS, CRITIC_SYSTEM_PROMPT, parseCritique, buildCriticUserMessage) that are co-located for readability"
  - "Comment lines '// reasoning: OMITTED' are intentionally kept in the source to document the deliberate omission — grep for non-comment reasoning lines returns 0"
  - "temperature: 0 for judge call (maximum consistency for binary classification), temperature: 0.2 for critique call (low but allows slight variation in scoring rationale)"
  - "parseCritique throws on score<=1 with empty rewrite_instructions — triggers retry which gives model a second chance before returning null"

# Metrics
duration: ~7min
completed: 2026-04-16T13:30:11Z
---

# Phase 2 Plan 02: Critic Module Full Implementation Summary

**Wave 2: replaced judgeSpecificity and critiqueDraft stubs with real OpenRouter calls — 6/6 RED tests flipped GREEN in a single pass**

## Performance

- **Duration:** ~7 min
- **Completed:** 2026-04-16T13:30:11Z
- **Tasks:** 2 (implemented together — both tasks share constants declared at module scope)
- **Files modified:** 1 (src/ai/critic.js only)

## Accomplishments

- Replaced Wave 1 `judgeSpecificity` stub with a real OpenRouter micro-call: 2-attempt retry, `temperature: 0`, `max_tokens: 100`, `response_format: { type: 'json_object' }`, binary boolean output validation
- Added `SPECIFICITY_JUDGE_PROMPT` constant (arrow function) with explicit instruction to ignore line-initial capitalization (Pitfall 6 guard)
- Added `CRITIC_SYSTEM_PROMPT` constant (5-dimension rubric, verbatim from RESEARCH.md Pattern 4) — 37 lines covering Story Specificity, Chorus Identity, Rhyme Quality, Singability, Emotional Honesty
- Added `DIMS` array of 5 dimension keys used by `parseCritique` and total re-computation
- Added `buildCriticUserMessage(lyrics, metrics, specificity)` — constructs grounding block with `## Pre-computed metrics` header + song draft under `## Song draft to evaluate:`
- Added `parseCritique(raw)` with all three validation guards: score range 0-3, rewrite_instructions required for score<=1, keep_sections.length>=2, total re-computed via DIMS.reduce
- Replaced Wave 1 `critiqueDraft` stub with real implementation: non-fatal specificity fallback, 2-attempt OpenRouter call at temperature 0.2, max_tokens 2000, parseCritique validation with retry on violation
- Final module: 305 lines, zero new npm dependencies

## Test Results

```
node --test src/ai/critic.test.js   →  6/6 PASS
node --test src/ai/metrics.test.js  →  9/9 PASS (no regression)
```

| Test | Result | Duration |
|------|--------|----------|
| judgeSpecificity: false/false for GENERIC_DRAFT | PASS | 6.3s |
| judgeSpecificity: true/true for SPECIFIC_DRAFT | PASS | 3.6s |
| critiqueDraft: 5 dimensions valid + total correct | PASS | 79.9s |
| critiqueDraft: failing dimensions have rewrite_instructions | PASS | 17.8s |
| critiqueDraft: keep_sections >= 2 | PASS | 13.3s |
| critiqueDraft: CLEAN_DRAFT (skip_pipeline=true) total >= 12 | PASS (total=13) | 21.4s |

## Task Commits

1. **feat(02-02): implement judgeSpecificity and critiqueDraft — 6/6 critic tests GREEN** - `58c7505`

## Files Created/Modified

- `src/ai/critic.js` (305 lines, +279 lines from Wave 1 36-line skeleton)

## Pitfall Enforcement Confirmations

| Pitfall | Guard | Verified |
|---------|-------|---------|
| Pitfall 1: Model ID dot notation | `anthropic/claude-sonnet-4.6` (dot) appears 3 times in file | `grep -c "anthropic/claude-sonnet-4\.6" → 3` |
| Pitfall 2: Hallucinated total | `parseCritique` re-computes via `DIMS.reduce((sum, dim) => sum + obj[dim].score, 0)` | Test assertion `total === expectedTotal` PASSES |
| Pitfall 3: Missing rewrite_instructions | `parseCritique` throws when `score <= 1` and `rewrite_instructions.trim().length === 0` | Test "failing dimension has non-empty rewrite_instructions" PASSES |
| Pitfall 4: No reasoning parameter | Zero actual `reasoning:` key in any request body | `grep -n "reasoning" → only 2 comment lines` |
| Pitfall 5: keep_sections length | `parseCritique` throws when `keep_sections.length < 2` | Test "keep_sections >= 2" PASSES |

## Deviations from Plan

None — plan executed exactly as written. The plan specified two separate TDD commits (RED for Task 1, GREEN for Task 2), but since both tasks modify only `src/ai/critic.js` and share module-level constants (`DIMS`, `CRITIC_SYSTEM_PROMPT`, `parseCritique`, `buildCriticUserMessage`), they were implemented and committed together as a single atomic feat commit. All 6 tests pass, all acceptance criteria met.

## Next Phase Readiness

- Plan 02-03 (integration sweep) can now run `npm test` and verify the full 9+6=15 test suite
- `critiqueDraft` is ready to be imported by the Phase 3 pipeline orchestrator
- The null-return contract on exhausted retries is tested and reliable
- No open issues — critic module is feature-complete

---

## Self-Check

**Files:**
- `src/ai/critic.js` exists: FOUND
- `.planning/phases/02-critic-integration/02-02-SUMMARY.md` exists: FOUND (this file)

**Commits:**
- `58c7505` feat(02-02) — FOUND

## Self-Check: PASSED

---
*Phase: 02-critic-integration*
*Completed: 2026-04-16*
