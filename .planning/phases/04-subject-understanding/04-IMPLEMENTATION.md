# Phase 4 — Subject Understanding (Implementation Notes)

**Commits:**
- `d967c5d` — feat(ai): add Subject Understanding (U) step before G→C→R pipeline
- `69032b1` — fix(ai): ground the listener — force category nouns into lyrics

**Files touched:** 5 source + 1 test + 2 docs

| File | d967c5d | 69032b1 | Total |
|---|---:|---:|---:|
| `src/ai/analyzer.js` | +175 (new) | +44 −6 | 213 |
| `src/ai/pipeline.js` | +40 −12 | +27 | 55 net |
| `src/ai/client.js` | +49 −2 | +41 −4 | 84 net |
| `src/ai/critic.js` | +32 −13 | +24 | 43 net |
| `src/ai/rewriter.js` | +36 −10 | +19 | 45 net |
| `package.json` | +1 −1 | — | 0 net |

---

## Module: `src/ai/analyzer.js`

**Export:** `understandSubject({occasion, genre, mood, voice, wishes}) → Promise<portrait | null>`

**Model:**
```js
const ANALYZER_MODEL = process.env.AI_ANALYZER_MODEL
  || config.ai.criticModel              // re-uses critic model
  || 'anthropic/claude-sonnet-4.6';
```

**API call shape:**
```js
{
  model: ANALYZER_MODEL,
  messages: [
    { role: 'system', content: ANALYZER_SYSTEM_PROMPT },  // ~3KB
    { role: 'user', content: buildAnalyzerUserMessage({ occasion, genre, mood, voice, wishes }) },
  ],
  response_format: { type: 'json_object' },
  max_tokens: 1500,
  temperature: 0.3,
  // reasoning omitted — structured extraction, no thinking
}
```

**Retries:** 2 attempts with 1.5s backoff. Returns `null` if both fail.

**Validation (`parsePortrait`):**
- `core_identity` non-empty string
- `unique_quirks` array, length ≥ 2
- `subject_category_nouns` array, length ≥ 1, each entry non-empty string
- `emotional_dynamic` non-empty string
- `scenes_to_use` array, length ≥ 2 (prompt asks for exactly 3 — lenient floor)
- `tonal_register` ∈ enum {tender, playful, triumphant, bittersweet, reverent, cheeky}
- `wordplay_opportunity` string OR null
- `phrases_to_AVOID` array, length ≥ 2

**Defensive filter (post-validation):**
```js
const categorySet = new Set(obj.subject_category_nouns.map(n => n.toLowerCase().trim()));
obj.phrases_to_AVOID = obj.phrases_to_AVOID.filter(p => {
  if (typeof p !== 'string') return false;
  const trimmed = p.trim();
  if (trimmed.length === 0) return false;
  if (!trimmed.includes(' ')) return false;          // drop bare single-word entries
  if (categorySet.has(trimmed.toLowerCase())) return false;  // drop category-noun dupes
  return true;
});
```

This is the runtime guard against the bug from commit d967c5d → 69032b1: even if
the model accidentally returns a bare «пёс» in the avoid list, it gets stripped
before the portrait reaches the generator.

---

## Module: `src/ai/pipeline.js` (changes)

**New constant:**
```js
const ANALYZER_TIMEOUT_MS = 30_000;   // 30s — single Sonnet call, no thinking
```

**New Step U** (executed first):
```js
let portrait = null;
try {
  portrait = await withTimeout(
    understandSubject({ occasion, genre, mood, voice, wishes }),
    ANALYZER_TIMEOUT_MS,
    'understandSubject'
  );
  if (portrait) {
    console.log(`[pipeline] portrait core_identity: ${portrait.core_identity}`);
    console.log(`[pipeline] portrait tonal_register: ${portrait.tonal_register}`);
  } else {
    console.log('[pipeline] portrait null — degrading to wishes-only generation');
  }
} catch (e) {
  console.log('[pipeline] analyzer step failed:', e.message, '— proceeding without portrait');
  portrait = null;
}
```

**Portrait threading** — added to all 3 downstream calls:
```js
const draft = await generateLyrics({ occasion, genre, mood, voice, wishes, portrait });
critique = await withTimeout(critiqueDraft(draft.lyrics, draft.metrics, portrait), ...);
rewritten = await withTimeout(rewriteDraft(draft.lyrics, critique, portrait), ...);
```

**Grounding visibility:**
```js
function logGroundingCheck(lyrics, portrait, stage) {
  const nouns = Array.isArray(portrait?.subject_category_nouns)
    ? portrait.subject_category_nouns.filter(n => typeof n === 'string' && n.trim().length)
    : [];
  if (!nouns.length) return;
  const lower = lyrics.toLowerCase();
  const present = nouns.filter(n => lower.includes(n.toLowerCase()));
  if (present.length) {
    console.log(`[pipeline] grounding ok (${stage}): present ${present.map(n => `«${n}»`).join(', ')}`);
  } else {
    console.log(`[pipeline] ⚠ grounding MISS (${stage}): none of ${nouns.map(n => `«${n}»`).join(', ')} appear in lyrics`);
  }
}
```

Called at two stages:
- After `generateLyrics()` returns (`stage = 'draft'`)
- After accepted rewrite returns (`stage = 'rewritten'`)

---

## Module: `src/ai/client.js` (changes)

**Function:** `formatPortraitBlock(portrait) → string`

Builds the SUBJECT PORTRAIT block injected at top of user prompt. Layout:

```
## SUBJECT PORTRAIT (use this as the PRIMARY creative foundation ...):

CORE IDENTITY: <core_identity>

══ MUST-MENTION WORDS (CRITICAL — GROUND THE LISTENER) ══
The listener must be able to tell WHAT the subject is within the first 4 lines of [Куплет 1].
Use AT LEAST ONE of these exact Russian nouns somewhere in the song (preferably in the first verse):
  «пёс», «лабрадор», «лапа», «хвост»
These are NOT clichés — these are the bare nouns that name the subject's category.
Without them, the song becomes a riddle: "is this about a horse? a man? a dog?".
Wordplay and metaphor go ON TOP of grounding, NEVER INSTEAD of it.

UNIQUE QUIRKS (specific habits — weave these into verses, do not just list them):
  • <quirk 1>
  • <quirk 2>
  ...

EMOTIONAL DYNAMIC (...): <emotional_dynamic>

SCENES TO USE (build verses around these visual moments):
  1. <scene 1>
  2. <scene 2>
  3. <scene 3>

TONAL REGISTER: <register> — match this energy throughout.

WORDPLAY OPPORTUNITY: <wordplay_opportunity>           ← only if non-null

PHRASES TO AVOID — these are FULL MULTI-WORD CLICHÉS to avoid verbatim, NOT forbidden words.
You ARE allowed to use any individual word inside these phrases in other contexts.
e.g., "верный пёс" is banned as a phrase, but "пёс" alone is REQUIRED (see MUST-MENTION above).
  ✗ «верный пёс»
  ✗ «преданный друг»
  ...

══ REPEAT: at least one of «пёс», «лабрадор», «лапа», «хвост» MUST appear in the final song,
   ideally in [Куплет 1]. ══
```

**Function signature:**
```js
export async function generateLyrics({ occasion, genre, mood, voice, wishes, portrait = null }) {
  // ...
  const portraitBlock = portrait ? formatPortraitBlock(portrait) + '\n\n' : '';
  const userPrompt = portraitBlock + `Напиши песню на русском языке.\n` + ... ;
  // ...
}
```

---

## Module: `src/ai/critic.js` (changes)

**Function signature:**
```js
export async function critiqueDraft(lyrics, metrics, portrait = null) { ... }
```

**Portrait injection in user message:**
```
## SUBJECT PORTRAIT (built by analyzer — the draft MUST capture this character;
   use as benchmark for story_specificity and chorus_identity):
```json
{
  "core_identity": "...",
  "subject_category_nouns": ["пёс", "лабрадор", "лапа", "хвост"],
  ...
}
```

## GROUNDING CHECK (pre-computed — DO NOT contradict):
Subject category nouns from portrait: «пёс», «лабрадор», «лапа», «хвост»
Found in draft: (NONE)
Missing: «пёс», «лабрадор», «лапа», «хвост»
VERDICT: GROUNDING FAIL — the listener cannot identify the subject's category.
You MUST set story_specificity.score = 0 and write rewrite_instructions that
REQUIRE inserting at least one of the missing nouns into [Куплет 1].

## Pre-computed metrics (treat as GROUNDING FACTS — do not contradict these):
{ banale_pairs: [...], syllable_violations: [...], ... }

## Song draft to evaluate:
[lyrics here]
```

**Determinism:** the GROUNDING CHECK section is computed by JavaScript using
case-insensitive substring matching, then handed to the critic as a fact. The
critic does not get to override the verdict — it only writes the rewrite
instructions for the failed dimension.

---

## Module: `src/ai/rewriter.js` (changes)

**Function signature:**
```js
export async function rewriteDraft(lyrics, critique, portrait = null) { ... }
```

**Portrait injection in user message:**
```
## ПОРТРЕТ СУБЪЕКТА (сохрани этот характер при переписи — не размывай его в общие фразы):
```json
{ ...portrait... }
```

## ОБЯЗАТЕЛЬНЫЕ СЛОВА (заземляют слушателя — без них непонятно про КОГО песня):
В финальном тексте ОБЯЗАТЕЛЬНО должно прозвучать ХОТЯ БЫ ОДНО из:
   «пёс», «лабрадор», «лапа», «хвост»
⚠️ В оригинальном черновике НИ ОДНО из этих слов НЕ встречается — это критическая
   ошибка заземления. Обязательно вставь одно из них в [Куплет 1] при переписи.
   Это НЕ нарушение KEEP — это исправление пропущенного.

## РАЗДЕЛЫ KEEP (воспроизведи дословно, символ за символом):
[Куплет 1], [Бридж]

## КРИТИКА (исправь разделы с оценкой 0-1):
[critique JSON or compressed bullets]

## ОРИГИНАЛЬНЫЙ ЧЕРНОВИК:
[lyrics]
```

The rewriter is told explicitly that inserting a missing category noun into
[Куплет 1] does NOT violate KEEP semantics — this prevents conservative
interpretation where the rewriter would refuse to touch a KEEP section even
if grounding requires it.

---

## Backward compatibility

All three downstream functions accept `portrait` as an optional 3rd/4th param
with `= null` default. Existing call sites unchanged:

```js
// All these still work — equivalent to passing portrait=null:
await generateLyrics({ occasion, genre, mood, voice, wishes });   // pre-Phase-4 callers
await critiqueDraft(lyrics, metrics);                              // tests
await rewriteDraft(lyrics, critique);                              // tests
```

The pipeline.test.js file was not modified — its 6 test cases continue to
pass because they call the 2-arg shape and our default makes this equivalent
to the wishes-only pre-Phase-4 behaviour.
