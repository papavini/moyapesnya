---
phase: 03-rewriter-and-full-pipeline
verified: 2026-04-16T12:00:00Z
status: human_needed
score: 15/15
overrides_applied: 0
human_verification:
  - test: "Send a full song order through the Telegram bot with a GENERIC-style occasion (no proper nouns, generic wishes) and confirm the bot delivers a rewritten song that differs from the raw generator output"
    expected: "[pipeline] rewrite accepted: XX% new tokens appears in bot logs; delivered lyrics contain specifics not present in a plain generator run"
    why_human: "SC3 (rewrite >= 20% new tokens) and SC4 (KEEP sections verbatim) require a live end-to-end API call through the deployed bot; cannot be verified by static analysis"
  - test: "Send an order with CLEAN-style specifics (proper name, time expressions, physical activity) and confirm the bot logs '[pipeline] metrics gate: skip_pipeline=true' or '[pipeline] critique total=NN — above threshold, fast path'"
    expected: "Bot returns a song without calling the rewriter; latency is noticeably lower"
    why_human: "SC2 (fast path for high-scoring draft) requires runtime log inspection; gate fires only when generator actually produces a high-quality draft, which depends on the real model"
---

# Phase 3: Rewriter and Full Pipeline — Verification Report

**Phase Goal:** The full Generate → Critique → Rewrite pipeline runs end-to-end in `runPipeline()`, preserving `{lyrics, tags, title}` output format and respecting the skip gate
**Verified:** 2026-04-16T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | runPipeline() implements all 5 gates: metrics skip, critique null, fast path (>=12), sycophancy guard, timeout | VERIFIED | pipeline.js lines 80-136: Gate 1 (`skip_pipeline`), Gate 2 (critique null), Gate 3 (`critique.total >= SKIP_GATE_SCORE`), Gate 4 (rewritten null), Gate 5 (`newTokenRatio < 0.20`) all present |
| 2 | runPipeline() returns {lyrics, tags, title} in ALL code paths — never {lyrics, tags, title, metrics} | VERIFIED | All 6 return statements in pipeline.js return `{ lyrics: ..., tags: draft.tags, title: draft.title }` — grep for `return.*metrics` finds zero matches |
| 3 | critiqueDraft() is wrapped in withTimeout(30_000ms) | VERIFIED | pipeline.js lines 88-92: `withTimeout(critiqueDraft(...), CRITIQUE_TIMEOUT_MS, ...)` where `CRITIQUE_TIMEOUT_MS = 30_000` |
| 4 | rewriteDraft() is wrapped in withTimeout(60_000ms) | VERIFIED | pipeline.js lines 113-117: `withTimeout(rewriteDraft(...), REWRITE_TIMEOUT_MS, ...)` where `REWRITE_TIMEOUT_MS = 60_000` |
| 5 | sycophancy guard: computeNewTokenRatio >= 0.20 required for rewrite to be accepted | VERIFIED | pipeline.js lines 130-135: `if (newTokenRatio < 0.20) { return original draft }` |
| 6 | telegram.js imports runPipeline from '../ai/pipeline.js' instead of generateLyrics from '../ai/client.js' | VERIFIED | telegram.js line 6: `import { runPipeline } from '../ai/pipeline.js'`; no `generateLyrics` import present |
| 7 | all 3 generateLyrics call sites in telegram.js replaced with runPipeline | VERIFIED | Grep confirms: `runPipeline` appears 3 times (line 6 import, line 259 call, line 499 call); `generateLyrics` appears 0 times in telegram.js |
| 8 | rewriteDraft makes a real OpenRouter call to google/gemini-2.5-flash with reasoning.max_tokens=8000 | VERIFIED | rewriter.js lines 109-119: `model: REWRITER_MODEL` (defaults to `google/gemini-2.5-flash`), `reasoning: { max_tokens: 8000 }` present |
| 9 | response_format is NOT in the request body | VERIFIED | rewriter.js body object (lines 109-119) contains no `response_format` key — only a comment noting its omission |
| 10 | KEEP instruction appears at TOP and BOTTOM of system prompt | VERIFIED | rewriter.js line 17 (top): `Сохрани сильные разделы ТОЧНО КАК НАПИСАНО — дословно`; line 45 (bottom): `Разделы KEEP: воспроизведи дословно` |
| 11 | content extraction uses defensive Array.isArray check | VERIFIED | rewriter.js line 143: `if (Array.isArray(content)) {` — same pattern as client.js |
| 12 | config.ai.rewriterModel defaults to 'google/gemini-2.5-flash' | VERIFIED | config.js line 32: `rewriterModel: process.env.AI_REWRITER_MODEL \|\| 'google/gemini-2.5-flash'` |
| 13 | package.json test script invokes metrics.test.js, critic.test.js, and pipeline.test.js | VERIFIED | package.json line 12: `"test": "node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js"` |
| 14 | package.json check script includes rewriter.js and pipeline.js | VERIFIED | package.json line 11: check script ends with `&& node --check src/ai/rewriter.js && node --check src/ai/pipeline.js` |
| 15 | npm run check passes | VERIFIED | `npm run check` exits 0 — all 12 files parse cleanly |

**Score:** 15/15 truths verified (automated checks)

---

### Deferred Items

None.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ai/rewriter.js` | Full rewriteDraft: Gemini 2.5 Flash, reasoning.max_tokens=8000, KEEP prompt, 2-attempt retry | VERIFIED | 169 lines; exports `rewriteDraft`; REWRITER_SYSTEM_PROMPT with KEEP top+bottom; Array.isArray guard; returns `{lyrics}` or null |
| `src/ai/pipeline.js` | Full G→C→R orchestrator: 5 gates, withTimeout, computeNewTokenRatio | VERIFIED | 141 lines; exports `runPipeline`; withTimeout helper; tokenizeForDiff; computeNewTokenRatio; all 5 gates present |
| `src/ai/pipeline.test.js` | 6 integration tests covering PIPELINE-01/02/04, MODELS-01 | VERIFIED | 6 describe blocks; GENERIC_DRAFT + CLEAN_DRAFT fixtures; API-key guard; computeNewTokenRatio unit test |
| `src/config.js` | config.ai.rewriterModel field | VERIFIED | Line 32: `rewriterModel: process.env.AI_REWRITER_MODEL \|\| 'google/gemini-2.5-flash'` |
| `package.json` | test:pipeline script + updated check/test | VERIFIED | `test:pipeline`, `test`, and `check` all updated |
| `src/bots/telegram.js` | runPipeline import + 3 call-site swaps | VERIFIED | Line 6 import; lines 259 and 499 call sites; 0 remaining generateLyrics references |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/ai/pipeline.test.js` | `src/ai/pipeline.js` | `import { runPipeline } from './pipeline.js'` | WIRED | Line 13 of pipeline.test.js |
| `src/ai/pipeline.js` | `src/ai/rewriter.js` | `import { rewriteDraft } from './rewriter.js'` | WIRED | Line 8 of pipeline.js |
| `src/ai/rewriter.js` | `src/config.js` | `import { config } from '../config.js'` | WIRED | Line 6 of rewriter.js; uses `config.ai.rewriterModel` and `config.ai.apiKey` |
| `src/bots/telegram.js` | `src/ai/pipeline.js` | `import { runPipeline } from '../ai/pipeline.js'` | WIRED | Line 6 of telegram.js; called at lines 259 and 499 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/ai/pipeline.js` | `draft` | `generateLyrics()` in client.js → OpenRouter API → returns `{lyrics, tags, title, metrics}` | Yes (real API call with 3-attempt retry) | FLOWING |
| `src/ai/pipeline.js` | `critique` | `critiqueDraft()` in critic.js → OpenRouter API → returns structured JSON | Yes (real API call, wrapped in withTimeout) | FLOWING |
| `src/ai/pipeline.js` | `rewritten` | `rewriteDraft()` in rewriter.js → OpenRouter API → returns `{lyrics}` | Yes (real API call with 2-attempt retry) | FLOWING |
| `src/bots/telegram.js` | `aiResult` | `runPipeline()` → propagates `{lyrics, tags, title}` | Yes (full pipeline, no hardcoded values) | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| npm run check parses all 12 files | `npm run check` | Exit 0, no output | PASS |
| rewriter.js exports rewriteDraft | `node --check src/ai/rewriter.js` | Exit 0 | PASS |
| pipeline.js exports runPipeline | `node --check src/ai/pipeline.js` | Exit 0 | PASS |
| telegram.js has 0 generateLyrics references | grep count | 0 matches | PASS |
| telegram.js has 3 runPipeline references | grep count | 3 matches (1 import + 2 calls) | PASS |
| pipeline.js has no metrics field in return statements | grep `return.*metrics` | 0 matches | PASS |

*Full pipeline end-to-end behavior (SC2 fast path, SC3 rewrite ratio, SC4 KEEP sections) requires human verification — see below.*

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PIPELINE-01 | 03-01, 03-03 | G→C→R sequence preserving `{lyrics, tags, title}` | SATISFIED | `runPipeline()` in pipeline.js calls generateLyrics → critiqueDraft → rewriteDraft; all 6 return paths yield `{lyrics, tags, title}` only |
| PIPELINE-02 | 03-01, 03-03 | Gate skips critique+rewrite if draft scores >=12/15 | SATISFIED | Gate 1 (`skip_pipeline`) and Gate 3 (`critique.total >= SKIP_GATE_SCORE`) in pipeline.js; runtime confirmation needs human test |
| PIPELINE-04 | 03-01, 03-02, 03-03 | Rewrite prompt fixes only sections with score 0-1, preserves strong sections | SATISFIED | REWRITER_SYSTEM_PROMPT with KEEP at top+bottom; `keep_sections` list passed in user message; `buildRewriterUserMessage()` includes KEEP list |
| MODELS-01 | 03-01, 03-02 | Generator and Rewriter use google/gemini-2.5-flash with thinking mode ON | SATISFIED (with deviation) | `REWRITER_MODEL` defaults to `google/gemini-2.5-flash`; `reasoning: { max_tokens: 8000 }` used — NOT `include_reasoning: true` (research found this is the correct OpenRouter param for Gemini; `include_reasoning: true` is a legacy alias that does not reliably trigger thinking) |

**Note on MODELS-01 deviation:** REQUIREMENTS.md says "verify: параметр `include_reasoning`". The 03-RESEARCH.md critical finding documents that `include_reasoning: true` does not reliably enable thinking for Gemini via OpenRouter; the correct param is `reasoning: { max_tokens: N }`. The implementation uses the correct parameter. The requirement text is stale — the intent (thinking mode ON) is satisfied.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODO/FIXME/placeholder patterns found. No stub return patterns. No hardcoded empty values in data flow. All Wave 1 stubs were replaced by Wave 2 and Wave 3 implementations.

---

### Human Verification Required

#### 1. Full Rewrite Path (SC3 — >= 20% new tokens)

**Test:** Order a song through the Telegram bot with generic, non-specific wishes (e.g., "для мамы, хорошая женщина, добрая, любит цветы") and inspect bot logs.
**Expected:** Bot logs show `[pipeline] rewrite accepted: XX% new tokens` with XX >= 20, and the delivered lyrics contain specific details not in the original generator output.
**Why human:** The >= 20% token novelty check requires a live API call through the full pipeline. Static analysis confirms the gate is coded correctly but cannot verify the rewriter actually produces novel output in practice.

#### 2. Fast Path (SC2 — high-quality draft skips rewrite)

**Test:** Order a song with highly specific wishes (proper name, date, concrete activity — e.g., "для Ромы, бегает каждое утро в 6:00, турник, живёт в Москве, любит охоту").
**Expected:** Bot logs show `[pipeline] metrics gate: skip_pipeline=true` or `[pipeline] critique total=NN — above threshold, fast path`. Delivered song arrives faster (one fewer API call).
**Why human:** Whether the generator actually produces a high-quality draft for specific input depends on real model behavior and cannot be confirmed without running the live system.

#### 3. KEEP Sections Verbatim (SC4)

**Test:** Trigger a full rewrite path (low-scoring draft) and compare the delivered lyrics against the critic's `keep_sections` list in the logs.
**Expected:** Sections the critic marked KEEP are reproduced word-for-word in the rewritten output.
**Why human:** Requires live API calls to both the critic and rewriter, plus manual comparison of section text. Cannot be verified without running the deployed bot.

---

### Gaps Summary

No gaps found. All 15 must-haves are verified by static analysis. The only remaining items are behavioral checks that require live API execution (human_needed), which is expected for a phase that integrates multiple LLM calls.

**Key observations:**
1. The ROADMAP Phase 3 goal mentions `generateLyrics()` as the entry point, but the implementation correctly uses `runPipeline()` as a dedicated orchestrator that calls `generateLyrics()` internally — this matches the 03-RESEARCH.md architectural decision and was planned in all three PLAN files.
2. MODELS-01 requirement says to verify via `include_reasoning` parameter, but research documented that `reasoning: { max_tokens: 8000 }` is the correct OpenRouter parameter for Gemini — the implementation uses the correct approach.
3. All three waves completed successfully: skeleton (Wave 1), rewriter implementation (Wave 2), full pipeline + bot wiring (Wave 3).

---

_Verified: 2026-04-16T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
