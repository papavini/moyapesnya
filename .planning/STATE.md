---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 02
current_plan: 2
status: executing
last_updated: "2026-04-16T13:31:11.617Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
  percent: 100
---

# State — AI Poet Pipeline

**Project:** AI Poet Pipeline (Generate → Critique → Rewrite)
**Initialized:** 2026-04-16

---

## Project Reference

**Core value:** When a person hears their song they recognize themselves — laughs, cries, wants to send it to a friend.
**Current focus:** Phase 02 — Critic Integration

---

## Current Position

Phase: 02 (Critic Integration) — EXECUTING
Plan: 3 of 3
**Current phase:** 02
**Current plan:** 2
**Status:** Ready to execute
**Progress:** [██████████] 100%

```
[░░░░░░░░░░░░░░░░░░░░] 0%
P1 ░░░░░  P2 ░░░░░  P3 ░░░░░  P4 ░░░░░
```

---

## Phase Status

| Phase | Status | Plans | Notes |
|-------|--------|-------|-------|
| 1. Programmatic Metrics Gate | Complete ✅ | 3/3 | All plans done, VERIFICATION.md: 4/4 SC passed |
| 2. Critic Integration | In progress 🔄 | 2/3 | Plan 02 done — full implementation, 6/6 critic tests GREEN (58c7505) |
| 3. Rewriter and Full Pipeline | Not started | 0/0 | Gemini 2.5 Flash rewriter + orchestration |
| 4. A/B Validation and Threshold Calibration | Not started | 0/0 | Human blind listening, go/no-go |

---

## Performance Metrics

| Metric | Baseline | Target | Current |
|--------|----------|--------|---------|
| Generation latency | ~30-60s | <150s total | — |
| Pipeline cost | ~$0.010 | ~$0.005-0.006 | — |
| A/B win rate | — | >= 7/10 test cases | — |
| Gate skip rate | — | Calibrate after 20-30 runs | — |

---
| Phase 02 P01 | 3 | 2 tasks | 4 files |
| Phase 02 P02 | 7 | 2 tasks | 1 files |

## Accumulated Context

### Key decisions

- Build order: Metrics Gate FIRST — provides grounding data for critic and avoids unnecessary API calls on good drafts
- Generator/Rewriter model: `google/gemini-2.5-flash` with `include_reasoning: true` (thinking mode ON)
- Critic model: `anthropic/claude-sonnet-4.6` (dot notation, OpenRouter namespace) — different provider breaks echo chamber
- Wave 1/2 stub pattern: stubs export correct async shape returning fixed defaults (RED state), Wave 2 replaces stub bodies with real OpenRouter calls
- API-key guard before imports in test files: process.exit(0) when OPENROUTER_API_KEY unset — safe for CI and syntax checks
- Skip gate threshold: >= 12/15 (calibrate after first 20-30 production runs)
- No pipeline loops — single G→C→R pass only (Self-Refine paper: 80% of gains land in first pass)
- Hard constraints (JSON format, syllable limits) must appear at TOP and BOTTOM of rewriter prompt
- Context budget in rewriter: if total context > 4000 tokens, compress critique to bullet points

### Guardrails

- Max latency: 150s total; return best available draft on timeout
- Sycophancy guard: rewriter output must differ by >= 20% new tokens from draft
- Instruction drift guard: repeat all hard constraints at start AND end of rewriter system prompt
- Echo chamber guard: critic uses different provider (Anthropic) from generator (Google)

### Open questions

- Exact OpenRouter parameter for Gemini 2.5 Flash thinking mode (likely `include_reasoning: true` — verify before Phase 3)
- Exact OpenRouter model ID for Claude Sonnet 4.6 (`anthropic/claude-sonnet-4-6` — verify against openrouter.ai)
- Whether METRICS-03 (LLM specificity judge) should be a separate API call or folded into the critic prompt

### Todos

- Create `.planning/testcases/` directory with 10-15 real past requests before Phase 4
- Verify OpenRouter model IDs before Phase 3 implementation

---

## Session Continuity

**Last updated:** 2026-04-16T13:30:11Z
**Last completed milestone:** Phase 2 Plan 02 complete — judgeSpecificity + critiqueDraft full implementation, 6/6 critic tests GREEN, 9/9 metrics tests still GREEN (commit 58c7505)
**Next action:** Execute 02-03-PLAN.md — integration sweep + npm wiring verification
