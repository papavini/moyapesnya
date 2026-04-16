# Roadmap — AI Poet Pipeline

**Project:** AI Poet Pipeline (Generate → Critique → Rewrite)
**Created:** 2026-04-16
**Granularity:** Standard
**Requirements covered:** 13/13 ✓

---

## Phases

- [x] **Phase 1: Programmatic Metrics Gate** - Pure-JS quality detectors that score any draft before touching AI (completed 2026-04-16)
- [ ] **Phase 2: Critic Integration** - Claude Sonnet 4.6 critic with 5-dimension rubric, fed by Phase 1 metrics
- [ ] **Phase 3: Rewriter and Full Pipeline** - Gemini 2.5 Flash rewriter + end-to-end G→C→R orchestration with gate logic
- [ ] **Phase 4: A/B Validation and Threshold Calibration** - Test corpus, blind listening comparison, go/no-go decision

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
- [ ] 02-03-PLAN.md — Wave 3: verify suite + manual critique inspection + phase closure
**AI hint**: yes

### Phase 3: Rewriter and Full Pipeline
**Goal**: The full Generate → Critique → Rewrite pipeline runs end-to-end in `generateLyrics()`, preserving `{lyrics, tags, title}` output format and respecting the skip gate
**Depends on**: Phase 2
**Requirements**: PIPELINE-01, PIPELINE-02, PIPELINE-04, MODELS-01
**Success Criteria** (what must be TRUE):
  1. `generateLyrics()` returns valid `{lyrics, tags, title}` JSON for all execution paths (fast path, skip gate, full rewrite)
  2. A draft scoring >= 12/15 from the critic is returned directly without invoking the rewriter (fast path confirmed by log output)
  3. A draft scoring < 12/15 is rewritten — the rewriter output differs by >= 20% new tokens from the original draft
  4. Sections marked KEEP by the critic are reproduced verbatim (or near-verbatim) in the rewriter output
  5. End-to-end latency stays under 150 seconds; if any step exceeds its timeout the best available draft is returned with a log entry
**Plans**: TBD
**AI hint**: yes

### Phase 4: A/B Validation and Threshold Calibration
**Goal**: The pipeline's quality improvement over the single-step baseline is measured on real test cases and a go/no-go deployment decision is made
**Depends on**: Phase 3
**Requirements**: VALID-01, VALID-02, VALID-03
**Success Criteria** (what must be TRUE):
  1. A corpus of 10-15 test cases exists in `.planning/testcases/` with each case containing occasion, details, style, and a reference single-step output
  2. For each test case both pipelines have been run and their outputs are recorded side-by-side in a comparison table
  3. Blind listening results show the new pipeline wins >= 7/10 test cases (go decision) or the threshold calibration produces a concrete revised threshold value (calibration decision)
  4. The skip threshold (currently >= 12/15) is adjusted or confirmed based on observed score distribution across >= 20 runs
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Programmatic Metrics Gate | 3/3 | Complete   | 2026-04-16 |
| 2. Critic Integration | 2/3 | In Progress|  |
| 3. Rewriter and Full Pipeline | 0/0 | Not started | - |
| 4. A/B Validation and Threshold Calibration | 0/0 | Not started | - |
