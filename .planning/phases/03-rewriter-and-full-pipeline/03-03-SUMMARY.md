---
plan: 03-03
phase: 03-rewriter-and-full-pipeline
status: complete
wave: 3
completed: 2026-04-16
commit: f8c29a8
---

# Plan 03-03 Summary: Full Pipeline Orchestrator + Bot Wiring

## What Was Built

Replaced the Wave 1 stub in `src/ai/pipeline.js` with the full G→C→R orchestrator. Wired `src/bots/telegram.js` to use `runPipeline()` instead of `generateLyrics()`.

## Key Files

### Modified
- `src/ai/pipeline.js` — full `runPipeline()` with 5 gates, `withTimeout()`, `computeNewTokenRatio()`, `tokenizeForDiff()`; always returns `{lyrics, tags, title}` (never includes `metrics`)
- `src/bots/telegram.js` — import swapped to `runPipeline` from `../ai/pipeline.js`; both call sites updated (confirm_create handler + editing_lyrics handler)

## Invariants Verified

- `generateLyrics` → 0 occurrences in telegram.js ✓
- `runPipeline` → 3 occurrences in telegram.js (1 import + 2 call sites) ✓
- `CRITIQUE_TIMEOUT_MS = 30_000` ✓
- `REWRITE_TIMEOUT_MS = 60_000` ✓
- All 5 return paths return `{ lyrics: ..., tags: draft.tags, title: draft.title }` ✓
- `metrics` field never leaks into return value ✓
- `npm run check` → exits 0 ✓

## Self-Check: PASSED
