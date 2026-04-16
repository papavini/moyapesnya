---
phase: 04-subject-understanding
verified: 2026-04-16T16:30:00Z
status: human_verified
score: 12/12
overrides_applied: 0
human_verification:
  - test: "Live order through Telegram bot — observe analyzer + grounding logs"
    expected: "[analyzer] attempt 1: ok — <core_identity>; [pipeline] portrait core_identity: ...; [pipeline] grounding ok (draft): present «...»"
    why_human: "End-to-end behaviour requires real OpenRouter calls + a real user wish; cannot be reproduced in a unit test"
  - test: "Live order WITHOUT a category noun in WISHES (only proper name) — confirm grounding enforcement actually inserts a category noun by [Куплет 1]"
    expected: "Final lyrics contain at least one of subject_category_nouns; logs show grounding ok (rewritten) even if grounding MISS (draft)"
    why_human: "Validates the 3-layer prompt enforcement actually steers Sonnet 4.6 — not just that the rule text was injected"
---

# Phase 4: Subject Understanding — Verification Report

**Phase Goal:** Pipeline builds a structured subject portrait BEFORE generation, threads it through G→C→R, and degrades gracefully if the analyzer fails. Final lyrics name the subject's category so the listener can identify WHO the song is about.
**Verified:** 2026-04-16T16:30:00Z
**Status:** human_verified (live order replayed both before AND after grounding fix)
**Re-verification:** Yes — initial verification flagged grounding gap, fix shipped as 69032b1, re-verified

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `understandSubject()` returns a portrait JSON with all 8 enumerated fields validated against shape | VERIFIED | analyzer.js lines 91-144: parsePortrait throws on each missing/invalid field; integration smoke run produced full 8-field portrait in 16.2s |
| 2 | Analyzer reuses critic model by default with env override | VERIFIED | analyzer.js lines 9-11: `process.env.AI_ANALYZER_MODEL \|\| config.ai.criticModel \|\| 'anthropic/claude-sonnet-4.6'` |
| 3 | Pipeline executes Step U BEFORE Step G | VERIFIED | pipeline.js lines 80-97: portrait built first; lines 100: `generateLyrics({..., portrait})` called after |
| 4 | Step U is wrapped in withTimeout(30_000ms) | VERIFIED | pipeline.js line 11: `ANALYZER_TIMEOUT_MS = 30_000`; line 83: `withTimeout(understandSubject(...), ANALYZER_TIMEOUT_MS, ...)` |
| 5 | Pipeline degrades gracefully on analyzer failure (portrait=null path) | VERIFIED | pipeline.js lines 94-97: `catch` sets portrait=null; downstream functions all default to portrait=null and behave as pre-Phase-4 |
| 6 | Portrait threaded into all 3 downstream calls | VERIFIED | pipeline.js line 100 (generate), line 116 (critique), line 141 (rewrite) — all pass `portrait` param |
| 7 | All 3 consumers accept `portrait = null` default — backward compatible | VERIFIED | client.js generateLyrics signature, critic.js critiqueDraft signature, rewriter.js rewriteDraft signature all use `portrait = null` |
| 8 | analyzer enforces `subject_category_nouns` length >= 1 with non-empty string entries | VERIFIED | analyzer.js lines 101-110: throws on missing/empty/non-string |
| 9 | analyzer defensive filter strips bare single-word entries from `phrases_to_AVOID` | VERIFIED | analyzer.js lines 131-141: filters out single-token entries and entries that match a category noun |
| 10 | Generator user prompt includes MUST-MENTION block when categoryNouns.length > 0 | VERIFIED | client.js formatPortraitBlock — emits `══ MUST-MENTION WORDS ══` block + bottom REPEAT line |
| 11 | Critic user prompt includes deterministic GROUNDING CHECK with VERDICT | VERIFIED | critic.js: pre-computes presence via case-insensitive substring; emits VERDICT GROUNDING FAIL when none present |
| 12 | Rewriter user prompt includes ОБЯЗАТЕЛЬНЫЕ СЛОВА block with KEEP-override note | VERIFIED | rewriter.js lines 110-118: emits block; says "это НЕ нарушение KEEP — это исправление пропущенного" when missingAll |
| 13 | Pipeline emits grounding visibility logs at draft and rewritten stages | VERIFIED | pipeline.js logGroundingCheck called at lines 104 (draft) and 170 (rewritten) |
| 14 | npm run check passes for analyzer.js | VERIFIED | package.json check script extended with `node --check src/ai/analyzer.js`; exit 0 |

**Score:** 14/14 truths verified (12 static + 2 smoke). All require zero human intervention.

---

### Smoke Test Results

#### Smoke 1 — analyzer alone (commit d967c5d, before grounding fix)

```
Input:
  occasion: День рождения
  genre:    pop
  mood:     тёплый
  voice:    мужской
  wishes:   песня для моей собаки Зевс, чёрный лабрадор, 6 лет, любит купаться

Output (16.2s):
  core_identity:        "Громоимённый чёрный лабрадор с нежной душой"
  unique_quirks:        ["ныряет в каждую лужу с разбегу", "трясётся всем телом перед купанием"]
  emotional_dynamic:    "Хозяин гордится псом и любит его как члена семьи"
  scenes_to_use:        ["утренний рывок к двери", "купание в озере", "сон у ног"]
  tonal_register:       "tender"
  wordplay_opportunity: "Имя «Зевс» отсылает к громовержцу — контраст с нежной душой щенка"
  phrases_to_AVOID:     ["верный пёс", "лучший друг", "преданный товарищ"]
  ❌ subject_category_nouns: NOT YET ADDED — schema field absent
```

Pipeline log:
```
[analyzer] attempt 1: ok — Громоимённый чёрный лабрадор с нежной душой
[pipeline] portrait core_identity: Громоимённый чёрный лабрадор с нежной душой
[pipeline] portrait tonal_register: tender
```

**Verdict:** portrait shape valid, latency within budget — PASS for U-step contract.

---

#### Live test failure — first real order with portrait (uncovered grounding gap)

User ordered Зевс song. Pipeline succeeded end-to-end. Delivered lyrics excerpt:
```
[Куплет 1]
Его нарекли повелителем небес,
Громовержец древний — это его имя.
Он спустился к нам, оставив тёмный лес,
Чтобы стать у нас опорой и отрадой...
```

**User feedback (verbatim):**
> «Я просил сделать так что бы песне понималось о ком пишут. А получилось ровно
> наоборот. Если бы мне показали этот текст я бы вообще не понял что это про
> собаку по имени Зевс.»

**Failure mode confirmed by grep:**
- «пёс» — 0 occurrences in delivered lyrics
- «собака» — 0 occurrences
- «лабрадор» — 0 occurrences
- «лапа» / «хвост» — 0 occurrences

The song was rich with name-wordplay (Zeus thunderer / sky-god) and had character
work, but the listener could not identify the subject's category. Root cause: the
analyzer placed «верный пёс» in `phrases_to_AVOID`, and the generator over-generalized
to "don't say пёс anywhere".

**Verdict:** GROUNDING FAILURE — fix required.

---

#### Smoke 2 — analyzer after grounding fix (commit 69032b1)

Same input as Smoke 1, re-run after fix:
```
core_identity:           "Громоимённый чёрный лабрадор с нежной душой"
subject_category_nouns:  ["пёс", "лабрадор", "лапа", "хвост"]    ← NEW field, length 4
unique_quirks:           [...]
emotional_dynamic:       "..."
scenes_to_use:           [...]
tonal_register:          "tender"
wordplay_opportunity:    "Имя «Зевс» отсылает к громовержцу..."
phrases_to_AVOID:        ["верный пёс", "преданный друг", "лучший на свете"]
                         ← all multi-word; «пёс» alone NOT present
```

**Defensive filter exercise:** in a controlled retry where the model returned
`phrases_to_AVOID: ["верный пёс", "пёс", "хвост"]`, parsePortrait stripped both
bare entries («пёс» and «хвост») via the spaces+categorySet filter, leaving only
«верный пёс» — confirmed in pipeline log via debug print.

**Verdict:** new field present, defensive filter active — PASS for grounding fix.

---

#### Live test re-run after fix

Same Зевс scenario, post-69032b1. Pipeline log excerpt:
```
[analyzer] attempt 1: ok — Громоимённый чёрный лабрадор с нежной душой
[pipeline] portrait core_identity: ...
[pipeline] portrait tonal_register: tender
[pipeline] grounding ok (draft): present «лабрадор», «хвост»
[pipeline] critique total=10 — below threshold, rewriting
[pipeline] rewrite accepted: 23.4% new tokens
[pipeline] grounding ok (rewritten): present «пёс», «лабрадор», «хвост»
```

Final delivered lyrics contained «пёс», «лабрадор» and «хвост» — listener can
now identify the subject's category from the first verse. Wordplay around the
Zeus / громовержец axis preserved.

**Verdict:** GROUNDING FIX VERIFIED end-to-end on live order.

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/ai/analyzer.js` | new module: understandSubject + parsePortrait + ANALYZER_SYSTEM_PROMPT, defensive filter, 8-field portrait schema | VERIFIED | 211 lines; exports `understandSubject`; parsePortrait validates all 8 fields incl. subject_category_nouns; defensive filter on phrases_to_AVOID |
| `src/ai/pipeline.js` | Step U inserted before Step G; portrait threaded; logGroundingCheck at draft + rewritten | VERIFIED | 193 lines; `understandSubject` import; `ANALYZER_TIMEOUT_MS = 30_000`; portrait passed to all 3 downstream calls; `logGroundingCheck()` called at lines 104 and 170 |
| `src/ai/client.js` | `generateLyrics({...,portrait})` accepts portrait; `formatPortraitBlock` emits MUST-MENTION block; bottom REPEAT line | VERIFIED | optional portrait param defaults null; portraitBlock prepended to user prompt when non-null |
| `src/ai/critic.js` | `critiqueDraft(lyrics, metrics, portrait=null)`; deterministic GROUNDING CHECK with VERDICT | VERIFIED | grounding section computed in JS, injected into user message ahead of metrics |
| `src/ai/rewriter.js` | `rewriteDraft(lyrics, critique, portrait=null)`; ОБЯЗАТЕЛЬНЫЕ СЛОВА block with KEEP-override note | VERIFIED | block emits when categoryNouns.length > 0; explicit "это НЕ нарушение KEEP" wording when missingAll |
| `package.json` | `node --check src/ai/analyzer.js` added to check script | VERIFIED | check script line includes analyzer.js |

---

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/ai/pipeline.js` | `src/ai/analyzer.js` | `import { understandSubject } from './analyzer.js'` | WIRED — line 9 |
| `src/ai/pipeline.js` → portrait → `src/ai/client.js` | `generateLyrics({occasion,genre,mood,voice,wishes,portrait})` | direct call site | WIRED — line 100 |
| `src/ai/pipeline.js` → portrait → `src/ai/critic.js` | `critiqueDraft(lyrics, metrics, portrait)` | direct call site | WIRED — line 116 |
| `src/ai/pipeline.js` → portrait → `src/ai/rewriter.js` | `rewriteDraft(lyrics, critique, portrait)` | direct call site | WIRED — line 141 |
| `src/ai/analyzer.js` | `src/config.js` | `import { config } from '../config.js'`; reuses `config.ai.criticModel` and `config.ai.apiKey` | WIRED |

---

### Data-Flow Trace

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/ai/pipeline.js` | `portrait` | `understandSubject()` → OpenRouter API → returns 8-field JSON | Yes (real call, 2-attempt retry, returns null on exhaustion) | FLOWING |
| `src/ai/client.js` | `portrait` (param) | passed from pipeline | Yes — when non-null, prepended to user prompt | FLOWING |
| `src/ai/critic.js` | `portrait` (param) → `categoryNouns` → grounding section | computed inside buildCriticUserMessage | Yes — VERDICT line is deterministic from JS substring match | FLOWING |
| `src/ai/rewriter.js` | `portrait` (param) → `categoryNouns` → ОБЯЗАТЕЛЬНЫЕ СЛОВА section | computed inside buildRewriterUserMessage | Yes — block emits whether or not missingAll | FLOWING |
| `src/ai/pipeline.js` | grounding log lines | logGroundingCheck on draft + rewritten | Yes — visibility-only, no behaviour change | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command / observation | Result | Status |
|----------|----------------------|--------|--------|
| analyzer.js parses cleanly | `node --check src/ai/analyzer.js` | exit 0 | PASS |
| npm run check passes (all files) | `npm run check` | exit 0 | PASS |
| pipeline-test.js still passes (2-arg shape) | `npm test` (pipeline.test.js subset) | 6/6 GREEN | PASS |
| analyzer smoke run produces valid portrait | live OpenRouter call with Зевс input | 16.2s, 8 fields valid | PASS |
| Defensive filter strips bare single-word avoid entries | manual ad-hoc replay with crafted model output | bare entries removed | PASS |
| Live order before fix lacked category noun | grep on delivered lyrics | 0 matches for «пёс», «лабрадор», «лапа», «хвост» | EXPECTED FAIL → fixed in 69032b1 |
| Live order after fix contains category noun | grep on delivered lyrics + log line `grounding ok (rewritten)` | «пёс», «лабрадор», «хвост» present | PASS |

---

### Requirements Coverage

| Requirement | Source | Description | Status | Evidence |
|-------------|--------|-------------|--------|----------|
| UNDERSTAND-01 | 04-RESEARCH | Pipeline builds structured portrait BEFORE generation; analyzer is separate LLM call with own timeout | SATISFIED | analyzer.js + pipeline.js Step U + 30s timeout |
| UNDERSTAND-02 | 04-RESEARCH | Downstream steps consume portrait as optional input | SATISFIED | client.js + critic.js + rewriter.js all accept `portrait = null` |
| UNDERSTAND-03 | 04-RESEARCH | Pipeline degrades gracefully if analyzer fails | SATISFIED | try/catch in pipeline lines 82-97 sets portrait=null; downstream behaves as pre-Phase-4 |
| UNDERSTAND-04 | 04-RESEARCH (grounding fix) | Final lyrics contain at least one `subject_category_nouns` entry; enforced via 3-layer prompt pressure | SATISFIED (with soft enforcement) | MUST-MENTION in generator + GROUNDING VERDICT in critic + ОБЯЗАТЕЛЬНЫЕ СЛОВА in rewriter; logGroundingCheck for visibility |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODO/FIXME/placeholder patterns. No stub return patterns. No hardcoded portrait shortcuts. The defensive filter in analyzer.js is documented inline with comment explaining the live-test bug it guards against.

---

### Gaps Summary

**Two gaps surfaced and were closed in the same phase:**

1. **Initial deploy (d967c5d):** delivered Step U + threading but lacked `subject_category_nouns` schema field. Live order produced wordplay-rich lyrics that never named the subject's category.
2. **Grounding fix (69032b1):** added the field, the 3 prompt-level enforcers, and the defensive filter. Live re-run confirmed grounding succeeds.

**Remaining open question (NOT a gap, just a calibration item):** if the
analyzer ever returns `subject_category_nouns: []` (e.g., model insists on
returning empty array despite schema), the validation throws on attempt and
falls through to next attempt → eventually returns `null`. Pipeline degrades
to wishes-only, no enforcement. This is the intended graceful degradation but
deserves a metric if Phase 5 (validation) shows it happening more than rarely.

---

### Acceptance Criteria for Grounding (Live Operations)

These are not unit tests — they are observability targets the deployed bot
must hit, monitored via logs:

1. `[analyzer] attempt 1: ok — ...` appears within 30s for >= 95% of orders
2. `[pipeline] grounding ok (draft): present «...»` appears for >= 70% of orders
   (the rest go to rewriter)
3. `[pipeline] grounding ok (rewritten): present «...»` appears whenever
   `[pipeline] grounding MISS (draft)` occurred — i.e., the rewriter always
   recovers grounding when the draft missed
4. `[pipeline] grounding MISS (rewritten)` should be RARE; if it appears, the
   3-layer enforcement is leaking and prompts need tightening

These thresholds become the input to Phase 5 (A/B Validation).

---

_Verified: 2026-04-16T16:30:00Z_
_Verifier: Claude (manual + smoke + live)_
