---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 5
current_plan: Not started
status: planning
last_updated: "2026-04-16T16:30:00.000Z"
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 9
  completed_plans: 9
  percent: 80
---

# State — AI Poet Pipeline

**Project:** AI Poet Pipeline (Understand → Generate → Critique → Rewrite)
**Initialized:** 2026-04-16

---

## Project Reference

**Core value:** When a person hears their song they recognize themselves — laughs, cries, wants to send it to a friend.
**Current focus:** Phase 5 — A/B Validation and Threshold Calibration

---

## Current Position

Phase: 4 (Subject Understanding) — COMPLETE ✅
**Current phase:** 5
**Current plan:** Not started
**Status:** Ready to plan
**Progress:** [████████████████░░░░] 80%

```
[████████████████░░░░] 80%
P1 █████  P2 █████  P3 █████  P4 █████  P5 ░░░░░
```

---

## Phase Status

| Phase | Status | Plans | Notes |
|-------|--------|-------|-------|
| 1. Programmatic Metrics Gate | Complete ✅ | 3/3 | All plans done, VERIFICATION.md: 4/4 SC passed |
| 2. Critic Integration | Complete ✅ | 3/3 | 6/6 critic tests GREEN, 5/5 SC met, manual inspection approved (commit 58c7505) |
| 3. Rewriter and Full Pipeline | Complete ✅ | 3/3 | 15/15 auto checks GREEN; live tuning shipped: rewriter→Sonnet 4.6, sycophancy 15%, fast-path off |
| 4. Subject Understanding | Complete ✅ | 0/0 (no sub-plans) | Same-day phase: deploy d967c5d → live failure → grounding fix 69032b1 → re-verify GREEN |
| 5. A/B Validation and Threshold Calibration | Not started | 0/0 | Human blind listening, go/no-go |

---

## Performance Metrics

| Metric | Baseline | Target | Current |
|--------|----------|--------|---------|
| Generation latency | ~30-60s | <180s total (was 150s; +30s for Step U) | ~120s typical |
| Pipeline cost | ~$0.010 | ~$0.010-0.012 | +$0.005 from analyzer call |
| A/B win rate | — | >= 7/10 test cases | — (Phase 5) |
| Gate skip rate | — | Calibrate after 20-30 runs | fast path currently OFF |
| Grounding ok (draft) | — | >= 70% of orders | TBD (need >= 10 live samples) |
| Grounding MISS (rewritten) | — | near zero | TBD |

---

## Accumulated Context

### Key decisions

- Build order: Metrics Gate FIRST → Critic → Rewriter → **Subject Understanding** → A/B Validation
- Generator: `google/gemini-2.5-pro` (.env AI_MODEL) — different family from critic to break echo chamber
- Critic: `anthropic/claude-sonnet-4.6` (dot notation, OpenRouter)
- Rewriter: `anthropic/claude-sonnet-4.6` (switched from Gemini Flash after live tuning — Flash copied original at 1.3% novelty)
- **Analyzer (Phase 4):** `anthropic/claude-sonnet-4.6` (re-uses critic model by default; env override `AI_ANALYZER_MODEL`)
- Skip gate threshold: >= 12/15 (calibrate Phase 5)
- Sycophancy guard: >= 15% new tokens (lowered from 20% after geom. ceiling analysis)
- No pipeline loops — single U→G→C→R pass
- Hard constraints (JSON format, syllable limits, MUST-MENTION, KEEP) appear at TOP and BOTTOM of prompts (anti-drift guard)
- Step U is non-fatal: 30s timeout → null portrait → graceful degradation to wishes-only
- All downstream signatures backward compatible via `portrait = null` default
- 3-layer grounding enforcement: generator MUST-MENTION + critic deterministic VERDICT + rewriter explicit insertion (NO post-check, soft enforcement only)
- Defensive filter in analyzer: strip bare single-word entries from `phrases_to_AVOID`

### Guardrails

- Max latency: 180s total (raised from 150s for Step U); return best draft on timeout
- Sycophancy guard: rewriter output must differ by >= 15% new tokens
- Instruction drift guard: hard constraints at start AND end of prompts
- Echo chamber guard: critic uses different provider from generator
- Grounding guard: 3-layer prompt enforcement; visibility via logGroundingCheck

### Open questions

- When to flip metrics fast path back on? (currently OFF — 37 clusters didn't catch phrase clichés / AAAA monorhyme / fake rhymes)
- Phase 5 corpus: how to get 10-15 representative test cases without actually paying for them?
- Should grounding ever be a HARD post-check (reject + retry) or stay soft? — defer to Phase 5 evidence
- If `subject_category_nouns: []` edge case happens often → instrument

### Todos

- Create `.planning/testcases/` directory with 10-15 real past requests before Phase 5
- Monitor `[pipeline] grounding ok (draft|rewritten)` rates over the next 10-20 live orders
- If grounding MISS (rewritten) > 0 → tighten rewriter prompt

---

## Session Continuity

**Last updated:** 2026-04-16T16:30:00Z
**Last completed milestone:** Phase 4 complete — Step U deployed (d967c5d) + grounding fix (69032b1), live re-run confirmed «пёс»/«лабрадор»/«хвост» appear in delivered lyrics
**Next action:** `/gsd-plan-phase 5` — A/B Validation and Threshold Calibration
