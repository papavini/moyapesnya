# Phase 4: Subject Understanding — Summary

**Created:** 2026-04-16
**Completed:** 2026-04-16 (same-day phase: deploy → live test failure → fix → re-verify)
**Commits:** `d967c5d` (initial), `69032b1` (grounding fix)
**Phase goal:** Insert a Step U (Understand) before Step G in the pipeline so the AI poet has a real character study — not just raw tags — when it sits down to write.
**Requirements covered:** UNDERSTAND-01, UNDERSTAND-02, UNDERSTAND-03, UNDERSTAND-04 (all 4 added in this phase, not in original ROADMAP)

---

## Why this phase happened

Seven consecutive live orders after Phase 3 deploy produced lyrics that were
technically clean (rhyme, syllable, structure) but **felt generic and
interchangeable**. The user complained:

> «Я бы хотел что бы Агент понимал о ком идёт речь и только потом думал
> как правильно сочинить стих. Мне кажеться он не понимает о чём сочиняет.»

Root cause: the generator was going straight from raw WISHES to lyrics with no
intermediate comprehension step. There was no character read, no emotional
angle, no sense of what made THIS subject recognizable.

---

## What this phase delivered

### New module — `src/ai/analyzer.js`
Single export `understandSubject({occasion, genre, mood, voice, wishes})` that
calls Claude Sonnet 4.6 (re-using `config.ai.criticModel`) to produce a
structured 8-field portrait JSON:

| Field | Purpose |
|---|---|
| `core_identity` | One-sentence claim about the subject (not a category) |
| `unique_quirks` | 2-4 specific habits that make this subject recognizable |
| `subject_category_nouns` | 2-4 nouns naming the subject's KIND (грunding hook) |
| `emotional_dynamic` | How the gift-giver relates to the subject |
| `scenes_to_use` | 3 visual moments the songwriter builds verses around |
| `tonal_register` | enum: tender / playful / triumphant / bittersweet / reverent / cheeky |
| `wordplay_opportunity` | name/role-based pun angle, or null |
| `phrases_to_AVOID` | 3-5 multi-word clichés specific to this subject |

- 2-attempt retry with 1.5s backoff
- temperature=0.3, no thinking (structured extraction, not creativity)
- Strict shape validation in `parsePortrait()`
- Defensive filter strips bare single-word entries from `phrases_to_AVOID`
  (the bug fix for the live test failure)
- Returns `null` on exhaustion → caller degrades gracefully

### Pipeline rewire — `src/ai/pipeline.js`
- Step U executes FIRST inside `runPipeline()`, wrapped in 30s timeout
- On failure → `portrait = null`, downstream behaves as pre-Phase-4
- Portrait threaded into all 3 downstream calls (generate, critique, rewrite)
- `logGroundingCheck()` emits ok/MISS log lines at draft and rewritten stages

### Three downstream consumers updated
| File | Change |
|---|---|
| `src/ai/client.js` | `generateLyrics({...,portrait=null})`; `formatPortraitBlock()` builds MUST-MENTION + character study + bottom REPEAT block |
| `src/ai/critic.js` | `critiqueDraft(lyrics, metrics, portrait=null)`; pre-computes deterministic GROUNDING CHECK with VERDICT line |
| `src/ai/rewriter.js` | `rewriteDraft(lyrics, critique, portrait=null)`; ОБЯЗАТЕЛЬНЫЕ СЛОВА section with explicit "это НЕ нарушение KEEP" override |

All signatures kept backward compatible via `portrait = null` default.

---

## The mid-phase failure → fix loop

| Stage | Outcome |
|---|---|
| 1. Deploy d967c5d | Step U + threading shipped. Smoke test: portrait valid, 16.2s. |
| 2. First live order | Зевс song delivered. Wordplay rich, but the words «пёс / собака / лабрадор / лапа / хвост» appeared zero times. Listener could not tell it was about a dog. |
| 3. User feedback | «Если бы мне показали этот текст я бы вообще не понял что это про собаку по имени Зевс.» |
| 4. Root cause | analyzer's `phrases_to_AVOID` list contained «верный пёс». Generator over-generalized to "don't say пёс anywhere". |
| 5. Fix 69032b1 | New schema field `subject_category_nouns` + 3-layer prompt enforcement (generator MUST-MENTION + critic deterministic VERDICT + rewriter explicit insertion instruction) + defensive filter in analyzer |
| 6. Re-verify | Smoke: portrait now contains `["пёс", "лабрадор", "лапа", "хвост"]`, avoid list only multi-word. Live re-run: «пёс», «лабрадор», «хвост» present in delivered lyrics. |

---

## Why soft enforcement (3 prompt layers), not hard post-check

A post-validation that rejects ungrounded lyrics and forces a retry was
considered. Rejected because:
- 3 independent prompt layers (generator + critic + rewriter) each steer
  toward grounded output — belt + braces + hook
- Hard post-check adds latency, complexity, possible infinite loops
- Graceful degradation > perfection: better to ship a slightly ungrounded
  song than an error
- `logGroundingCheck()` gives us visibility to detect slippage and tighten
  prompts later if needed

---

## Files Touched

| File | d967c5d | 69032b1 | Net |
|---|---:|---:|---:|
| `src/ai/analyzer.js` | +175 (new) | +44 −6 | 213 |
| `src/ai/pipeline.js` | +40 −12 | +27 | 55 |
| `src/ai/client.js` | +49 −2 | +41 −4 | 84 |
| `src/ai/critic.js` | +32 −13 | +24 | 43 |
| `src/ai/rewriter.js` | +36 −10 | +19 | 45 |
| `package.json` | +1 −1 | — | 0 |

5 source + 0 new test files (no test added — `pipeline.test.js` already covered
2-arg shapes which are now the `portrait=null` default — phase intentionally
preserved test surface).

---

## What it cost

- **Latency budget:** Step U adds ~15s in p50 / 30s in p99. Total pipeline
  budget moved from 150s → 180s (still well under user pain threshold).
- **API cost:** +1 Sonnet 4.6 call per song. ~$0.005 added per generation.
- **Code:** +440 net lines across 5 files; 1 new module.
- **Engineering time:** ~3 hours including the failure → fix loop.

---

## What it bought

- The poet now has a STORY to write about, not just a category + tags
- Wordplay opportunities surface naturally from `wordplay_opportunity` field
- Critic gets a deterministic grounding verdict — no more guessing whether
  the draft "captures the subject"
- Rewriter is explicitly told when to override KEEP for grounding repair
- Live ops have visibility (`grounding ok / MISS` log lines) for monitoring

---

## Open items (carried into Phase 5)

- Calibrate `[pipeline] grounding ok (draft)` rate — target >= 70%
- Track `[pipeline] grounding MISS (rewritten)` — should be near zero
- If portrait quality is uneven, consider human-editable portrait step (rejected
  for v1, may revisit)
- `subject_category_nouns: []` edge case (model insists on empty array) currently
  triggers retry → null → graceful degradation; instrument if frequency rises

---

## Next phase

**Phase 5 — A/B Validation and Threshold Calibration** (was Phase 4 in
original ROADMAP, renumbered after this insertion). Will measure quality lift
of the U→G→C→R pipeline vs the old G→C→R pipeline on a 10-15 case corpus.
