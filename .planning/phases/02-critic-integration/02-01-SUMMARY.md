---
phase: 02-critic-integration
plan: 01
subsystem: testing
tags: [openrouter, anthropic, critic, node-test, tdd]

# Dependency graph
requires:
  - phase: 01-programmatic-metrics-gate
    provides: scoreDraft() function from src/ai/metrics.js — used as fixture precondition in Fixture 3 test
provides:
  - src/ai/critic.js — async stubs for judgeSpecificity and critiqueDraft (Wave 1 skeleton)
  - src/ai/critic.test.js — 6 RED integration test cases locking the critic module contract
  - config.ai.criticModel field defaulting to 'anthropic/claude-sonnet-4.6'
  - npm test/test:critic/check scripts wired to critic files
affects: [02-02-PLAN, 02-03-PLAN, 03-rewriter-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "API-key guard exits process.exit(0) before any imports when env var is unset — enables safe node:test runs in CI without credentials"
    - "Wave 1 / Wave 2 stub pattern: stubs export correct async shape, return fixed defaults causing RED test state; Wave 2 replaces stub bodies"
    - "CRITIC_MODEL constant uses config.ai.criticModel with dot-notation OpenRouter model ID"

key-files:
  created:
    - src/ai/critic.js
    - src/ai/critic.test.js
  modified:
    - src/config.js
    - package.json

key-decisions:
  - "Wave 1 stub for judgeSpecificity returns {has_proper_nouns: false, has_time_expressions: false} — RED for SPECIFIC_DRAFT test (expects true/true)"
  - "Wave 1 stub for critiqueDraft returns null — RED for all 4 critiqueDraft tests (all assert critique !== null)"
  - "criticModel uses dot notation 'anthropic/claude-sonnet-4.6' — required by OpenRouter namespace (Anthropic API uses hyphen but OpenRouter uses dot)"
  - "API-key guard placed BEFORE dynamic imports so test file can be syntax-checked without credentials"

patterns-established:
  - "Guard-before-import pattern: process.exit(0) guard precedes all module imports that require credentials"
  - "DIMS array constant: test contracts encode dimension names as a reusable array to avoid repetition"
  - "Fixture 3 precondition assertion: test verifies skip_pipeline === true before asserting critique.total >= 12"

requirements-completed:
  - PIPELINE-03
  - MODELS-02
  - METRICS-03

# Metrics
duration: 3min
completed: 2026-04-16
---

# Phase 2 Plan 01: Critic Module Skeleton Summary

**Wave 1 critic.js skeleton with two async stubs + 6 RED integration tests locking the judgeSpecificity/critiqueDraft contract for Wave 2 implementation**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-16T13:20:04Z
- **Completed:** 2026-04-16T13:22:45Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `src/ai/critic.js` with two exported async stubs: `judgeSpecificity` (returns fixed `{has_proper_nouns: false, has_time_expressions: false}`) and `critiqueDraft` (returns `null`) — no network calls, Wave 1 skeleton only
- Added `config.ai.criticModel` defaulting to `'anthropic/claude-sonnet-4.6'` (dot notation, OpenRouter namespace) with `AI_CRITIC_MODEL` env override support
- Extended `package.json` scripts: `check` now includes `critic.js`, `test` now runs both `metrics.test.js` and `critic.test.js`, new `test:critic` script
- Created `src/ai/critic.test.js` with 6 integration test cases (2 judgeSpecificity + 4 critiqueDraft) and an API-key guard that exits 0 when `OPENROUTER_API_KEY` is unset

## Task Commits

Each task was committed atomically:

1. **Task 1: critic.js skeleton + config.ai.criticModel + package.json scripts** - `e1f6dad` (feat)
2. **Task 2: critic.test.js with 6 RED test cases** - `9c3f537` (test)

## Files Created/Modified

- `src/ai/critic.js` (36 lines) — Wave 1 skeleton: two async stub exports, CRITIC_MODEL constant, JSDoc contracts
- `src/ai/critic.test.js` (188 lines) — 6 RED integration tests: 3 fixtures (GENERIC/SPECIFIC/CLEAN), DIMS array, 2 describe blocks
- `src/config.js` (+1 line) — added `criticModel: process.env.AI_CRITIC_MODEL || 'anthropic/claude-sonnet-4.6'`
- `package.json` (+2 scripts, extended check) — test:critic added, test extended, check extended

## Decisions Made

- Dot notation `anthropic/claude-sonnet-4.6` used in both `critic.js` and `config.js` — this is OpenRouter's namespace format; Anthropic's own API uses hyphens but OpenRouter requires dots (per RESEARCH.md Pitfall 1)
- API-key guard placed at top of test file before any imports — ensures `node --check src/ai/critic.test.js` always works, and `npm run test:critic` exits 0 cleanly in environments without credentials
- Wave 1 stub returns `false/false` for `judgeSpecificity` — this means Test 1 (GENERIC_DRAFT, expects false/false) passes accidentally in Wave 1, but Test 2 (SPECIFIC_DRAFT, expects true/true) fails correctly. This is acceptable RED state — Wave 2 must make both pass.

## RED State Confirmation

When `OPENROUTER_API_KEY` is unset:
- `OPENROUTER_API_KEY="" npm run test:critic` → exits 0, prints `[critic.test] OPENROUTER_API_KEY not set — skipping`

When `OPENROUTER_API_KEY` is set and Wave 1 stubs are in place:
- All 4 `critiqueDraft` tests FAIL (stub returns `null`, assertions reject with `assert.ok(critique !== null)`)
- `judgeSpecificity` Test 2 FAILS (stub returns `false/false`, expects `true/true` for SPECIFIC_DRAFT)
- Only `judgeSpecificity` Test 1 passes by coincidence (GENERIC_DRAFT also expects `false/false`)

This is the intended RED state. Wave 2 replaces stub bodies with real OpenRouter calls.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. `OPENROUTER_API_KEY` is already in `.env` from Phase 1.

## Next Phase Readiness

- Wave 2 (Plan 02-02) implements `judgeSpecificity` and `critiqueDraft` with real OpenRouter calls against the contract locked by these 6 tests
- The `anthropic/claude-sonnet-4.6` model ID must be verified against `openrouter.ai` before Wave 2 (open question in STATE.md)
- `npm run check` passes — codebase is clean and deployable

---
*Phase: 02-critic-integration*
*Completed: 2026-04-16*
