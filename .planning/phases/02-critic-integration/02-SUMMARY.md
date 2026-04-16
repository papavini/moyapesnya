# Phase 2: Critic Integration — Plan Index

**Created:** 2026-04-16
**Total plans:** 3 (3 waves)
**Phase goal:** A draft + Phase 1 metrics can be evaluated by Claude Sonnet 4.6 and returned as a structured JSON critique with section-level verdicts.
**Requirements covered:** PIPELINE-03, MODELS-02, METRICS-03

---

## Wave Structure

| Wave | Plan | Title | Autonomous | Depends On |
|------|------|-------|------------|------------|
| 1 | 02-01 | Skeleton + RED tests + config + scripts | yes | — |
| 2 | 02-02 | Full implementation (judgeSpecificity + critiqueDraft) | yes | 02-01 |
| 3 | 02-03 | Verify suite + manual inspection + phase closure | no (1 checkpoint) | 02-01, 02-02 |

---

## File Ownership (no overlap → safe to verify in isolation)

| File | Plan(s) That Modify It | Notes |
|------|------------------------|-------|
| `src/ai/critic.js` | 02-01 (skeleton), 02-02 (implementation) | Sequential — Wave 2 replaces Wave 1 stubs |
| `src/ai/critic.test.js` | 02-01 only | Created once, never modified |
| `src/config.js` | 02-01 only | Adds `criticModel` field |
| `package.json` | 02-01 only | Extends scripts |
| `.planning/STATE.md`, `.planning/ROADMAP.md` | 02-03 only | Phase closure updates |

No two plans modify the same file in the same wave — fully serial dependency chain by design.

---

## Plan Summaries

### Plan 02-01 — Wave 1: Skeleton + RED Tests
Creates `src/ai/critic.js` with two callable async stubs, `src/ai/critic.test.js` with 6 RED integration tests, adds `config.ai.criticModel`, and wires npm scripts. After this plan, the contract for Wave 2 is locked: tests run, stubs return shape-incompatible defaults, RED state confirmed.

**Files:** src/ai/critic.js (new), src/ai/critic.test.js (new), src/config.js (mod), package.json (mod)
**Tasks:** 2

### Plan 02-02 — Wave 2: Full Implementation
Replaces the two Wave 1 stubs with real OpenRouter calls. Task 1 implements `judgeSpecificity()` (METRICS-03 micro-call); Task 2 implements `critiqueDraft()` (PIPELINE-03 5-dimension critique with parser, retry, and Pitfall 2/3/5 validation). All 6 critic tests flip GREEN.

**Files:** src/ai/critic.js (replace stubs)
**Tasks:** 2

### Plan 02-03 — Wave 3: Verify + Sign-off
Runs the full test suite (15 tests across metrics + critic), greps to confirm Pitfall 4 (no `reasoning` parameter) and Pitfall 1 (dot model ID), pauses for human inspection of one critique to confirm `rewrite_instructions` quality (subjective, can't be automated), then writes the phase closure summary and updates STATE.md + ROADMAP.md.

**Files:** none (verification only) + `.planning/phases/02-critic-integration/02-03-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`
**Tasks:** 3 (1 auto + 1 checkpoint:human-verify + 1 auto)

---

## Source Coverage Audit

| Source | Item | Covered By |
|--------|------|------------|
| GOAL | "draft + metrics evaluated by Claude Sonnet 4.6" | 02-02 critiqueDraft |
| GOAL | "structured JSON critique with section-level verdicts" | 02-02 parseCritique + keep_sections |
| REQ | PIPELINE-03 (5 dimensions, 0-3, total) | 02-01 (test contract) + 02-02 (impl) |
| REQ | MODELS-02 (anthropic/claude-sonnet-4.6) | 02-01 (config + constant) + 02-02 (call) |
| REQ | METRICS-03 (specificity micro-call) | 02-01 (test contract) + 02-02 (impl) |
| RESEARCH | Pattern 1 — fetch+retry pattern | 02-02 |
| RESEARCH | Pattern 2 — json_object + system prompt | 02-02 |
| RESEARCH | Pattern 3 — critique JSON schema | 02-01 (test) + 02-02 (parser) |
| RESEARCH | Pattern 4 — system prompt verbatim | 02-02 (constant) |
| RESEARCH | Pattern 5 — specificity micro-call | 02-02 (judgeSpecificity) |
| RESEARCH | Pattern 6 — metrics as grounding | 02-02 (buildCriticUserMessage) |
| RESEARCH | Pattern 7 — error handling, null return | 02-02 (critiqueDraft retry loop) |
| RESEARCH | Pitfall 1 — dot model ID | 02-01 (config) + 02-02 grep guard |
| RESEARCH | Pitfall 2 — total recompute | 02-02 (parseCritique reduce) |
| RESEARCH | Pitfall 3 — rewrite_instructions guard | 02-02 (parseCritique throw) |
| RESEARCH | Pitfall 4 — no reasoning param | 02-02 + 02-03 grep gate |
| RESEARCH | Pitfall 5 — keep_sections >= 2 | 02-02 (parseCritique throw) |
| CONTEXT (STATE) | "Critic uses anthropic/claude-sonnet-4-6, different provider" | 02-01 + 02-02 |
| CONTEXT (STATE) | "No pipeline loops — single G→C→R pass" | Out of scope (Phase 3 owns orchestration) |

All in-scope items mapped. Out-of-scope items (skip-gate decision, rewriter call, pipeline orchestration) explicitly belong to Phase 3.

---

## Anti-Patterns Avoided

- No "v1/static for now" language — full critique implementation in Wave 2, not stub-shaped
- No reduction of REQ scope — METRICS-03 stays as a separate testable micro-call, NOT folded into critic prompt
- No mocking in tests — integration tests use real API (consistent with Phase 1 conventions)
- No new npm dependencies (RESEARCH "Standard Stack" — zero deps required)

---

## Next After Phase 2

`/gsd-plan-phase 3` — Phase 3 (Rewriter and Full Pipeline) consumes the critique JSON contract defined here. Phase 3 will:
- Call `critiqueDraft(lyrics, scoreDraft(lyrics))` from inside `generateLyrics()`
- Apply the skip-gate (`critique.total >= 12` → return draft as-is)
- On a failing critique: call the Gemini 2.5 Flash rewriter with `keep_sections` + `rewrite_instructions`
- Preserve the `{lyrics, tags, title}` output contract that SUNO depends on
