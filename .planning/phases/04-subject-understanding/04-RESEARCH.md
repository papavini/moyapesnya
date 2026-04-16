# Phase 4 — Subject Understanding Layer (Research)

**Created:** 2026-04-16
**Status:** Complete (deployed as commits d967c5d + 69032b1)
**Depends on:** Phase 3 (G→C→R pipeline)

---

## Problem statement

After Phase 3 deployed (G→C→R pipeline with Sonnet 4.6 critic + rewriter), we
observed 7 consecutive live orders where the generated lyrics — while technically
correct (rhyme, syllable, structure) — felt **generic and interchangeable**.
Users could not tell the song was written about THEIR specific subject.

Concrete observations (all orders were about «Зевс» — a black Labrador):

1. Iteration 1 — «отвратительный» per user: abstract pathos («повелитель»), fillers («это уже факт»), clichés («самый добрый на свете»).
2. Iteration 2 — «Хвост как пропеллер»: better scene work, but weak rhyme pairs.
3. Iteration 3 — «Зевс — это гром»: could have been about any dog.
4. Iteration 4 (Pro generator) — cold, grey, metaphor-heavy, no warmth.
5. Iteration 5 — «серые полотна»: metaphor overload, no subject.
6. Iteration 6 — «чёрный бархат»: back to generic clichés.
7. Iteration 7 — «Чёрный вихрь»: good but flat.

**User diagnosis (verbatim):**
> «Я бы хотел что бы Агент понимал о ком идёт речь и только потом думал
> как правильно сочинить стих. Мне кажеться он не понимает о чём сочиняет.»

**Core finding:** The generator was going directly from raw WISHES to lyrics
without ever **comprehending** the subject. It had no character study, no
emotional read, no sense of what makes THIS subject recognizable.

---

## Architectural decision

Add a **Step U (Understand)** to the pipeline, executed BEFORE Step G (Generate):

```
User input → [U] Understand → [G] Generate → [C] Critique → [R] Rewrite → SUNO
```

**Step U output = portrait JSON**, consumed by all downstream steps as a
structured character study. The portrait captures:

| Field | Purpose |
|---|---|
| `core_identity` | One-sentence CLAIM about the subject (not a category) |
| `unique_quirks` | 2-4 specific observable habits that make THIS subject recognizable |
| `subject_category_nouns` | 1-4 nouns naming the subject's CATEGORY (added in grounding fix) |
| `emotional_dynamic` | How the gift-giver relates to the subject |
| `scenes_to_use` | 3 visual moments for the songwriter to build verses around |
| `tonal_register` | Single enum: tender / playful / triumphant / bittersweet / reverent / cheeky |
| `wordplay_opportunity` | Name/history/role-based wordplay angle, or null |
| `phrases_to_AVOID` | 3-5 multi-word clichés specific to this subject |

---

## Design principles

1. **Non-fatal analyzer:** pipeline degrades gracefully if Step U fails or
   times out (30s budget). Portrait = null → all downstream steps run with
   the previous wishes-only behavior. Same contract, no user-visible errors.

2. **Structured extraction, not creativity:** analyzer uses `temperature=0.3`,
   no `reasoning` — consistent JSON shape matters more than prose flair.

3. **Validation over trust:** analyzer's `parsePortrait()` enforces shape
   strictly; invalid shape → retry (2 attempts) → null → graceful degradation.

4. **Optional parameter propagation:** `portrait` threaded through
   `generateLyrics`, `critiqueDraft`, `rewriteDraft` as an optional param
   (default `null`). Old 2-arg call sites keep working unchanged.

5. **Prompt rendering:** each consumer formats the portrait into its own
   natural block:
   - generator → free-form "SUBJECT PORTRAIT" character study block at top
     of user prompt
   - critic → JSON-fenced block labelled "use as benchmark for
     story_specificity and chorus_identity"
   - rewriter → JSON-fenced block with instruction "preserve this character"

---

## Live test failure → grounding fix

The first live order after d967c5d deploy produced a song about Зевс that was
rich with wordplay (Zeus-thunderer / Zeus-water-god) and character work —
**but never named the species**. The words «пёс», «собака», «лабрадор»,
«лапа», «хвост» appeared zero times. A listener could not tell whether the
song was about a dog, a horse, or a young man.

**User diagnosis (verbatim):**
> «Я просил сделать так что бы песне понималось о ком пишут. А получилось
> ровно наоборот. Если бы мне показали этот текст я бы вообще не понял что
> это про собаку по имени Зевс.»

**Root cause:** The analyzer's `phrases_to_AVOID` list contained «верный пёс»
as a cliché to skip. The generator over-generalized "don't use the word
пёс anywhere" and built the entire song around wordplay and metaphor,
never once grounding the listener in the subject's category.

**Fix (commit 69032b1) — layered across 5 files:**

1. **Analyzer:** new portrait field `subject_category_nouns` (1-4 bare nouns
   naming the subject's KIND). Prompt explicitly states `phrases_to_AVOID`
   must be multi-word clichés, never bare category nouns. Defensive filter
   in `parsePortrait()` strips any bare single-word entry or any entry that
   matches a `subject_category_nouns` value.

2. **Generator:** `formatPortraitBlock()` opens with a prominent
   MUST-MENTION WORDS section stating "the listener must hear AT LEAST ONE
   of these in the first 4 lines". Rule is repeated at the bottom of the
   portrait block (anti-drift guard). `phrases_to_AVOID` block now clarifies
   "these are FULL clichés to avoid verbatim, individual words inside them
   are allowed".

3. **Critic:** pipeline pre-computes whether any `subject_category_nouns`
   appears in the draft (case-insensitive substring). If NONE found, the
   critic is told "GROUNDING FAIL — you MUST set story_specificity=0 with
   rewrite_instructions requiring insertion of a category noun into
   [Куплет 1]". This deterministically routes grounding-failed drafts
   through the rewrite path.

4. **Rewriter:** receives the same grounding check. If the draft missed
   all nouns, the rewriter is instructed "ОБЯЗАТЕЛЬНО вставь одно из X в
   [Куплет 1] — это НЕ нарушение KEEP, это исправление пропущенного".

5. **Pipeline:** `logGroundingCheck()` logs grounding status at `draft`
   stage and after `rewritten` — visibility only, does not alter behaviour.
   Example log lines:
   - `[pipeline] grounding ok (draft): present «лабрадор», «хвост»`
   - `[pipeline] ⚠ grounding MISS (draft): none of «пёс», «лабрадор» appear in lyrics`

---

## Why soft enforcement (prompt layers) over hard post-check

Option considered: add a post-validation in pipeline.js that rejects any
lyrics lacking a category noun and forces a retry. Rejected because:

- Three layers of prompt-level enforcement (generator + critic + rewriter)
  each independently steer toward grounded output — belt + braces + hook
- Hard post-check would add latency + complexity + possible infinite loops
- Graceful degradation is more important than perfection: if a grounding
  miss slips through, we still ship a song
- Visibility via `logGroundingCheck()` lets us detect any slippage and
  tighten prompts later if needed

---

## Alternatives considered

- **Two-pass generation in a single model call** (one generator with
  "think step-by-step about the subject first"). Rejected: single-model
  echo chamber, critic can't catch comprehension failures, no separation
  of concerns.

- **Analyzer integrated into critic** (critic extracts portrait during
  critique). Rejected: critic comes AFTER generate — too late to feed the
  generator. The whole point is comprehension BEFORE writing.

- **Human-editable portrait step** (show portrait to user, let them edit
  before generation). Rejected for v1: would add a conversational round,
  complicate state machine, users may not know what to edit. Revisit if
  portrait quality becomes a recurring complaint.

---

## Requirements added (not in original ROADMAP)

- **UNDERSTAND-01:** pipeline builds a structured subject portrait BEFORE
  generation. Portrait is JSON with enumerated fields. Analyzer runs as a
  separate LLM call with its own timeout budget.
- **UNDERSTAND-02:** downstream steps (generate, critique, rewrite) consume
  the portrait as an optional input and weave it into their prompts.
- **UNDERSTAND-03:** pipeline degrades gracefully if analyzer fails —
  downstream steps work without portrait using prior behaviour.
- **UNDERSTAND-04 (grounding fix):** the final lyrics must contain at
  least one noun from a `subject_category_nouns` list so the listener can
  identify the subject's category. Enforced via 3-layer prompt pressure
  (generator / critic / rewriter).
