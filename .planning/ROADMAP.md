# Roadmap — AI Poet Pipeline

**Project:** AI Poet Pipeline (Understand → Generate → Critique → Rewrite)
**Created:** 2026-04-16
**Granularity:** Standard
**Requirements covered:** 13/13 + 4 added (UNDERSTAND-01..04) ✓

---

## Phases

- [x] **Phase 1: Programmatic Metrics Gate** - Pure-JS quality detectors that score any draft before touching AI (completed 2026-04-16)
- [x] **Phase 2: Critic Integration** - Claude Sonnet 4.6 critic with 5-dimension rubric, fed by Phase 1 metrics (completed 2026-04-16)
- [x] **Phase 3: Rewriter and Full Pipeline** - Gemini 2.5 Flash rewriter + end-to-end G→C→R orchestration with gate logic (completed 2026-04-16)
- [x] **Phase 4: Subject Understanding** - Step U analyzer builds rich subject portrait BEFORE generation; 3-layer grounding enforcement keeps the listener oriented (completed 2026-04-16)
- [ ] **Phase 5: A/B Validation and Threshold Calibration** - Test corpus, blind listening comparison, go/no-go decision

---

## Phase Details

### Phase 1: Programmatic Metrics Gate
**Goal**: Any draft can be measured for banale rhymes, syllable violations, and vocabulary diversity without an AI call
**Depends on**: Nothing (first phase)
**Requirements**: METRICS-01, METRICS-02, METRICS-04
**Success Criteria** (what must be TRUE):
  1. A draft with known banale rhyme pairs (любовь/кровь, розы/слёзы) triggers a non-empty `banale_pairs` list in the output
  2. A chorus line exceeding 12 syllables is flagged in `syllable_violations` with the line text and count
  3. A short repetitive draft scores below 0.60 on the MATTR-approx metric; a varied draft scores above
  4. The gate function returns `{banale_pairs, syllable_violations, lexical_diversity, skip_pipeline}` synchronously with no API calls
**Plans**: 3 plans
Plans:
- [x] 01-01-PLAN.md — Wave 0: skeleton src/ai/metrics.js + failing test suite (RED state)
- [x] 01-02-PLAN.md — Implement banale/syllable/MATTR/gate; flip tests to GREEN
- [x] 01-03-PLAN.md — Wire scoreDraft into src/ai/client.js + add npm test scripts

### Phase 2: Critic Integration
**Goal**: A draft plus pre-computed metrics can be evaluated by Claude Sonnet 4.6 and returned as a structured JSON critique with section-level verdicts
**Depends on**: Phase 1
**Requirements**: PIPELINE-03, MODELS-02, METRICS-03
**Success Criteria** (what must be TRUE):
  1. Critic returns valid JSON with scores for all 5 dimensions (Story Specificity, Chorus Identity, Rhyme Quality, Singability, Emotional Honesty), each 0-3, plus a `total` field
  2. Each failing dimension (score 0-1) has a non-empty `rewrite_instructions` entry with a quoted evidence line from the draft
  3. The critique includes a `keep_sections` list with at least 2 sections marked KEEP
  4. The LLM-judge specificity call (METRICS-03) contributes to the Story Specificity score — a draft with no proper nouns or time expressions scores lower than one with them
  5. A draft passing the Phase 1 gate with no banale pairs and no syllable violations produces a critique `total` >= 12 (skip condition holds)
**Plans**: 3 plans
Plans:
- [x] 02-01-PLAN.md — Wave 1: skeleton src/ai/critic.js + RED test contract + config + scripts
- [x] 02-02-PLAN.md — Wave 2: implement judgeSpecificity + critiqueDraft, flip 6 tests to GREEN
- [x] 02-03-PLAN.md — Wave 3: verify suite + manual critique inspection + phase closure
**AI hint**: yes

### Phase 3: Rewriter and Full Pipeline
**Goal**: The full Generate → Critique → Rewrite pipeline runs end-to-end in `runPipeline()`, preserving `{lyrics, tags, title}` output format and respecting the skip gate
**Depends on**: Phase 2
**Requirements**: PIPELINE-01, PIPELINE-02, PIPELINE-04, MODELS-01
**Success Criteria** (what must be TRUE):
  1. `runPipeline()` returns valid `{lyrics, tags, title}` JSON for all execution paths (fast path, skip gate, full rewrite)
  2. A draft scoring >= 12/15 from the critic is returned directly without invoking the rewriter (fast path confirmed by log output)
  3. A draft scoring < 12/15 is rewritten — the rewriter output differs by >= 15% new tokens from the original draft (lowered from 20% after live tuning)
  4. Sections marked KEEP by the critic are reproduced verbatim (or near-verbatim) in the rewriter output
  5. End-to-end latency stays under 150 seconds; if any step exceeds its timeout the best available draft is returned with a log entry
**Plans**: 3 plans
Plans:
- [x] 03-01-PLAN.md — Wave 1: skeleton src/ai/rewriter.js + src/ai/pipeline.js + RED tests + config + scripts
- [x] 03-02-PLAN.md — Wave 2: rewriter implementation (Gemini 2.5 Flash, KEEP guard, retry, content-array)
- [x] 03-03-PLAN.md — Wave 3: full pipeline orchestration + bot wiring + verification
**AI hint**: yes

### Phase 4: Subject Understanding
**Goal**: Pipeline builds a structured subject portrait BEFORE generation. Step U (Understand) is inserted before Step G; portrait is threaded into all downstream steps; final lyrics name the subject's category so the listener can identify WHO the song is about.
**Depends on**: Phase 3
**Requirements**: UNDERSTAND-01, UNDERSTAND-02, UNDERSTAND-03, UNDERSTAND-04 (added during phase, not in original ROADMAP)
**Success Criteria** (what must be TRUE):
  1. `understandSubject()` returns a structured portrait JSON with 8 enumerated fields validated against shape, or `null` on exhaustion
  2. Step U executes BEFORE Step G inside `runPipeline()` and is wrapped in a 30s timeout
  3. Pipeline degrades gracefully if analyzer fails — downstream steps run with `portrait = null` and behave as pre-Phase-4
  4. Portrait is threaded as an optional 3rd/4th parameter into `generateLyrics()`, `critiqueDraft()`, `rewriteDraft()` — all backward compatible with default `portrait = null`
  5. Final lyrics contain at least one entry from `subject_category_nouns` (grounding constraint), enforced via 3-layer prompt pressure (generator MUST-MENTION + critic deterministic VERDICT + rewriter explicit insertion)
**Plans**: 0 (executed without sub-plans — same-day phase: deploy → live failure → fix → re-verify)
**AI hint**: no

### Phase 5: A/B Validation and Threshold Calibration
**Goal**: The pipeline's quality improvement over the single-step baseline is measured on real test cases and a go/no-go deployment decision is made
**Depends on**: Phase 4
**Requirements**: VALID-01, VALID-02, VALID-03
**Success Criteria** (what must be TRUE):
  1. A corpus of 10-15 test cases exists in `.planning/testcases/` with each case containing occasion, details, style, and a reference single-step output
  2. For each test case both pipelines have been run and their outputs are recorded side-by-side in a comparison table
  3. Blind listening results show the new pipeline wins >= 7/10 test cases (go decision) or the threshold calibration produces a concrete revised threshold value (calibration decision)
  4. The skip threshold (currently >= 12/15) is adjusted or confirmed based on observed score distribution across >= 20 runs
  5. Grounding metrics from Phase 4: `grounding ok (draft)` rate >= 70%, `grounding MISS (rewritten)` rate near zero
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Programmatic Metrics Gate | 3/3 | Complete   | 2026-04-16 |
| 2. Critic Integration | 3/3 | Complete   | 2026-04-16 |
| 3. Rewriter and Full Pipeline | 3/3 | Complete    | 2026-04-16 |
| 4. Subject Understanding | 0/0 (no sub-plans) | Complete   | 2026-04-16 |
| 5. A/B Validation and Threshold Calibration | 0/0 | Not started | - |
