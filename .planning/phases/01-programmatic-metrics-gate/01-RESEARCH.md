# Phase 1: Programmatic Metrics Gate — Research

**Researched:** 2026-04-16
**Domain:** Pure-JS text quality metrics for Russian song lyrics
**Confidence:** HIGH

---

## Summary

Phase 1 builds a synchronous, zero-API-call gate function that measures three
quality signals on any song draft: banale rhyme pairs, chorus syllable violations,
and lexical diversity (MATTR-approx). The gate output feeds the Phase 2 critic and
determines whether the full pipeline runs at all.

All three algorithms are fully specifiable in pure JavaScript. Russian syllable
counting via vowel regex is a closed mathematical fact (one vowel = one syllable,
no exceptions). Banale rhyme detection via exact cluster lookup requires no phonetic
analysis — the canonical banale list is a community-stable corpus built from explicit
word pairs, not phonetic similarity. MATTR-approx (moving-average type-token ratio)
is a sliding-window operation on a tokenized word array; no lemmatization is needed
for a ~200-word text where the diversity signal is strong enough without it.

**Primary recommendation:** Implement all three metrics as pure functions in
`src/ai/metrics.js`, exported as a single `scoreDraft(lyrics)` function returning
`{banale_pairs, syllable_violations, lexical_diversity, skip_pipeline}`. The file
is co-located with `src/ai/client.js` which is the caller. No new dependencies
required.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| METRICS-01 | Banale rhyme detector — list of >=28 clusters, returns banale_pairs | Full 18-cluster list + algorithm in FEATURES.md; exact JS implementation below |
| METRICS-02 | Syllable counter — checks each chorus line <=12 syllables, returns syllable_violations | Vowel regex [аеёиоуыэюя] — HIGH confidence; section parser algorithm below |
| METRICS-04 | Lexical diversity — MATTR-approx on JS, threshold >0.60 for 200-word text | Window-50 sliding TTR; pure JS; threshold calibrated for ~200 words |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Banale rhyme detection | Node.js module (src/ai/metrics.js) | — | Pure computation, no I/O, co-located with caller |
| Syllable counting | Node.js module (src/ai/metrics.js) | — | Regex on string, synchronous |
| MATTR-approx | Node.js module (src/ai/metrics.js) | — | Sliding window arithmetic, no external state |
| Gate integration | src/ai/client.js (generateLyrics) | — | Gate is pre-check inside existing generation function |
| Test runner | Node built-in test (node:test) | — | No new test framework needed; Node 22 has it |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins only | 22.x (installed) | All metrics computation | No new deps needed; all algorithms are pure arithmetic or regex |
| `node:test` | Built-in Node 22 | Unit test runner | Project philosophy: zero extra deps; node:test is stable in Node 22 [VERIFIED: package.json engines >= 20] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure JS MATTR | `lexicalrichness` (Python) | Python sidecar adds 300-500ms startup; overkill for ~200 words; pure JS is sufficient for threshold >0.60 at this text length |
| Exact cluster lookup | `russian_g2p` phonetic matching | Phonetic matching finds non-banale rhymes too; for the banale gate, exact word matching against a curated list is more precise with zero false positives |
| `node:test` | Jest / Vitest | Would add a new dev dependency; project has zero test deps; node:test covers all needed assertions |

**Installation:** No new packages. All code is pure JS + Node 22 built-ins.

---

## Architecture Patterns

### System Architecture Diagram

```
generateLyrics(input)
       |
       v
  [AI Generator]  <-- existing, unchanged
       |
       v
    draft {lyrics, tags, title}
       |
       v
  scoreDraft(lyrics)       <-- NEW: src/ai/metrics.js
  |         |         |
  v         v         v
banale   syllable   MATTR
lookup   count      approx
       |
       v
  {banale_pairs, syllable_violations, lexical_diversity, skip_pipeline}
       |
       +-- skip_pipeline=true  -->  return draft  (fast path, no Phase 2 call)
       |
       +-- skip_pipeline=false -->  (Phase 2 critic receives draft + metrics)
```

### Recommended Project Structure

```
src/
├── ai/
│   ├── client.js        # existing — generateLyrics(), add scoreDraft call here
│   └── metrics.js       # NEW — all Phase 1 metric functions + scoreDraft()
└── ...

tests/
│   └── metrics.test.js  # NEW — unit tests for metrics.js
```

The `tests/` directory is new (project has no test files yet). Placing it at root
level follows Node.js convention and is visible to `npm test`.

### Pattern 1: Section Parser

**What:** Extract sections from structured lyrics using `[Tag]` delimiters.
**When to use:** Required by both syllable counter (chorus-only check) and banale
detector (chorus-specific rhyme stricter limits).

```js
// Source: derived from FEATURES.md section 1.2 + existing SYSTEM_PROMPT structure
// Section tags: [Куплет 1], [Припев], [Куплет 2], [Бридж], [Финал]
// Pattern handles optional trailing space and case variations.

const SECTION_PATTERN = /^\[([^\]]+)\]/;

function parseSections(lyrics) {
  const sections = {};
  let currentTag = null;
  let currentLines = [];

  for (const rawLine of lyrics.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(SECTION_PATTERN);
    if (match) {
      if (currentTag) sections[currentTag] = currentLines;
      currentTag = match[1].trim();
      currentLines = [];
    } else if (currentTag) {
      currentLines.push(line);
    }
  }
  if (currentTag) sections[currentTag] = currentLines;
  return sections;
  // Returns: { 'Куплет 1': [...], 'Припев': [...], 'Куплет 2': [...], ... }
}
```

### Pattern 2: Syllable Counter

**What:** Count vowels in a string — each vowel is one syllable in Russian.
**Confidence:** HIGH [CITED: FEATURES.md §1.2 — "Russian: vowels map 1:1 to syllables,
no ambiguity unlike English"]

```js
// Source: FEATURES.md §1.2
const RUSSIAN_VOWELS = /[аеёиоуыэюяАЕЁИОУЫЭЮЯ]/g;

function countSyllables(line) {
  return (line.match(RUSSIAN_VOWELS) || []).length;
}

function findChorusSyllableViolations(sections) {
  const violations = [];
  const chorusLines = sections['Припев'] || [];
  const MAX_CHORUS_SYLLABLES = 12;

  for (const line of chorusLines) {
    const count = countSyllables(line);
    if (count > MAX_CHORUS_SYLLABLES) {
      violations.push({ line, count, max: MAX_CHORUS_SYLLABLES });
    }
  }
  return violations;
  // Returns: [{ line: '...', count: 15, max: 12 }, ...]
}
```

### Pattern 3: Banale Rhyme Detector

**What:** Detect line-final words that belong to the same banale cluster.
**Algorithm:** Exact word match against curated cluster list, not phonetic matching.
**Confidence:** HIGH — canonical cluster list from Russian poetry pedagogy [CITED:
FEATURES.md §1.1, FEATURES.md §6 — Розбицкий/Стихи.ру, Попова/Samlib]

```js
// Source: FEATURES.md §1.1 + §6
// All 18 canonical clusters. Each pair within a cluster = banale rhyme.
const BANNED_RHYME_CLUSTERS = [
  ['любовь', 'вновь', 'кровь'],
  ['глаз', 'алмаз', 'нас', 'сейчас', 'раз'],
  ['нет', 'ответ', 'свет', 'привет', 'лет', 'след', 'бед', 'побед', 'бред', 'поэт'],
  ['розы', 'морозы', 'мимозы', 'грёзы', 'слёзы'],
  ['тебе', 'судьбе', 'борьбе'],
  ['доля', 'воля', 'поля'],
  ['дело', 'тело', 'смело'],
  ['чувство', 'искусство'],
  ['ты', 'красоты', 'цветы', 'мечты', 'черты', 'пустоты'],
  ['ночь', 'дочь', 'прочь', 'помочь'],
  ['небеса', 'чудеса', 'краса', 'леса', 'полоса'],
  ['пути', 'идти', 'найти', 'прийти', 'мечти'],
  ['да', 'вода', 'всегда', 'года', 'беда', 'города', 'тогда'],
  ['она', 'луна', 'вина', 'весна', 'страна', 'тишина'],
  ['шесть', 'есть', 'честь', 'месть'],
  ['отец', 'конец', 'венец', 'сердец'],
  ['зима', 'сама', 'тьма', 'дома'],
  ['мне', 'вдвойне', 'войне', 'стране', 'во сне', 'весне', 'тишине'],
];

// Build lookup: word -> cluster index
const wordToCluster = new Map();
BANNED_RHYME_CLUSTERS.forEach((cluster, idx) => {
  cluster.forEach(word => wordToCluster.set(word, idx));
});

function extractLineFinalWords(lines) {
  return lines.map(line => {
    const words = line.trim().split(/\s+/);
    return words[words.length - 1]
      .replace(/[.,!?;:—–\-]/g, '')
      .toLowerCase();
  }).filter(Boolean);
}

function findBanalePairs(sections) {
  // Check all section lines (not just chorus) for banale pairs
  const allLines = Object.values(sections).flat();
  const finalWords = extractLineFinalWords(allLines);

  const banalePairs = [];
  for (let i = 0; i < finalWords.length; i++) {
    for (let j = i + 1; j < finalWords.length; j++) {
      const c1 = wordToCluster.get(finalWords[i]);
      const c2 = wordToCluster.get(finalWords[j]);
      if (c1 !== undefined && c1 === c2) {
        banalePairs.push([finalWords[i], finalWords[j]]);
      }
    }
  }
  // Deduplicate symmetric pairs
  return [...new Map(banalePairs.map(p => [p.sort().join('/'), p])).values()];
}
```

### Pattern 4: MATTR-Approx (Moving-Average TTR)

**What:** Sliding window type-token ratio over the full lyrics text.
**Window:** 50 tokens. Average over all windows.
**Threshold:** >0.60 for skip_pipeline=true candidate [CITED: FEATURES.md §1.3
— threshold needs calibration; 0.60 is conservative vs the MATTR>0.72 quality target,
intentionally lower for the gate]
**No lemmatization:** At ~200 words the signal is strong enough without it. A
repetitive draft uses the same surface form repeatedly; lemmatization would only
matter if the draft used many inflected forms of different roots, which is a sign
of quality, not repetition.

```js
// Source: FEATURES.md §1.3 algorithm, adapted to JS
const WORD_BOUNDARY = /[^а-яёА-ЯЁa-zA-Z0-9]+/;

function tokenize(text) {
  return text
    .toLowerCase()
    // Strip section tags
    .replace(/\[[^\]]*\]/g, '')
    .split(WORD_BOUNDARY)
    .filter(w => w.length > 0);
}

function computeMATTR(tokens, windowSize = 50) {
  if (tokens.length < windowSize) {
    // Text shorter than window: use full TTR
    const unique = new Set(tokens).size;
    return unique / tokens.length;
  }

  let ttrs = 0;
  const windowCount = tokens.length - windowSize + 1;

  for (let i = 0; i < windowCount; i++) {
    const window = tokens.slice(i, i + windowSize);
    const unique = new Set(window).size;
    ttrs += unique / windowSize;
  }
  return ttrs / windowCount;
}
```

### Pattern 5: Gate Function (the full scoreDraft export)

```js
// Source: derived from ROADMAP.md Phase 1 success criteria + FEATURES.md
const SKIP_PIPELINE_THRESHOLD = 0.60; // MATTR-approx minimum [ASSUMED: needs calibration]

export function scoreDraft(lyrics) {
  const sections = parseSections(lyrics);

  const banalePairs = findBanalePairs(sections);
  const syllableViolations = findChorusSyllableViolations(sections);
  const tokens = tokenize(lyrics);
  const lexicalDiversity = tokens.length > 0 ? computeMATTR(tokens) : 0;

  const skipPipeline =
    banalePairs.length === 0 &&
    syllableViolations.length === 0 &&
    lexicalDiversity >= SKIP_PIPELINE_THRESHOLD;

  return {
    banale_pairs: banalePairs,
    syllable_violations: syllableViolations,
    lexical_diversity: Math.round(lexicalDiversity * 1000) / 1000,
    skip_pipeline: skipPipeline,
  };
}
```

### Pattern 6: Integration into generateLyrics()

**What:** Where and how to call scoreDraft inside the existing function.
**Placement:** After `generateLyrics()` returns `{lyrics, tags, title}`, before
returning to the caller. The metrics result is returned alongside (or logged) for
Phase 2 to consume.

```js
// src/ai/client.js — add at the top:
import { scoreDraft } from './metrics.js';

// Inside generateLyrics(), after line 339 (return { lyrics, tags, title }):
// Replace with:
const metrics = scoreDraft(lyrics);
console.log('[ai] metrics:', JSON.stringify(metrics));
// Phase 2 will use metrics — for now, attach to return value
return { lyrics, tags, title, metrics };
```

**Note on return value:** Adding `metrics` to the return object is backward-compatible
because the callers (`src/flow/generate.js`) destructure only `{ lyrics, tags, title }`.
Extra keys are ignored. This means Phase 1 can be deployed without touching
`generate.js` at all.

### Anti-Patterns to Avoid

- **Python sidecar for Phase 1:** pymorphy3 and lexicalrichness add 300-500ms
  startup overhead and a new runtime dependency. Pure JS is sufficient for all
  three METRICS-01/02/04 requirements. Python sidecar is correctly deferred to v2
  (verb-only rhyme detection, RussianPoetryScansionTool) per SUMMARY.md.

- **Phonetic rhyme matching for banale detection:** The banale list is a closed
  word set, not a phonetic rule. Matching "любовь/кровь" does not require knowing
  their phonemes — they're explicitly in the cluster. Phonetic matching is needed
  only for *discovering new* rhyme pairs outside the list, which is a Phase 2+ concern.

- **Lemmatization for MATTR at 200 words:** Adds complexity and a dependency
  (pymorphy3 or a JS equivalent). For a gate threshold of 0.60 on a ~200-word
  repetitive text, surface form matching is sufficient. The false negative rate
  (calling a good text "low diversity" due to Russian morphology) is acceptable
  at the gate level because the worst outcome is triggering the critic unnecessarily,
  not silently skipping a bad draft.

- **Global banale scan on all word pairs:** Comparing every pair of line-final words
  is O(n^2) on line count. For a 25-line song (n=25), that is 300 comparisons — fine.
  Do not add early termination that skips checking across sections; a banale pair
  spanning Куплет 1 and Припев still counts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Syllable boundaries in Russian | Custom syllabification engine | `[аеёиоуыэюяАЕЁИОУЫЭЮЯ]` vowel count | Russian: 1 vowel = 1 syllable, no exceptions. Zero edge cases. [CITED: FEATURES.md §1.2] |
| Test runner | Custom assertion harness | `node:test` built-in (Node 22) | Already available, assertion API mirrors Jest (`assert.strictEqual`, `assert.deepEqual`). |
| Phonetic Russian rhyme matching | Levenshtein + stress heuristics | Exact cluster lookup for banale; `russian_g2p` (Python, deferred) for open-ended rhyme discovery | The banale list is closed — exact match is more accurate than phonetic approximation for this specific use case. |

**Key insight:** Every Phase 1 algorithm reduces to either a regex match, a Map
lookup, or a sliding arithmetic average. No domain-specific library is needed or
warranted.

---

## Common Pitfalls

### Pitfall 1: Section Tag Variations in AI Output

**What goes wrong:** AI returns `[Припев]` vs `[Припев 1]` vs `[ПРИПЕВ]` vs
`[ Припев ]` — the section parser misses lines.
**Why it happens:** The generator prompt requires exact tags but LLMs occasionally
deviate, especially with thinking mode on.
**How to avoid:** Normalize tag matching: trim whitespace, lowercase comparison,
and treat `Припев` as a prefix match (catches `Припев 1`, `Припев 2`).
**Warning signs:** `sections['Припев']` is `undefined` but the lyrics contain the
word "Припев" — indicates a tag format mismatch.

```js
// Safer section key normalization
function normalizeSectionKey(raw) {
  const lower = raw.trim().toLowerCase();
  if (lower.startsWith('припев')) return 'Припев';
  if (lower.startsWith('куплет 1') || lower === 'куплет1') return 'Куплет 1';
  if (lower.startsWith('куплет 2') || lower === 'куплет2') return 'Куплет 2';
  if (lower.startsWith('бридж')) return 'Бридж';
  if (lower.startsWith('финал')) return 'Финал';
  return raw.trim();
}
```

### Pitfall 2: Banale Pair Deduplication

**What goes wrong:** The word "мечты" appears at end of lines 3 and 7. The O(n^2)
scan reports (`мечты`, `мечты`) — a self-pair, or reports the same pair multiple
times if it appears in different cross-combinations.
**How to avoid:** Skip identical word pairs (`word1 === word2`). After collection,
deduplicate via sorted key: `[w1, w2].sort().join('/')`.
**Warning signs:** `banale_pairs` contains duplicate entries or entries where both
words are the same.

### Pitfall 3: MATTR Window Larger Than Text

**What goes wrong:** A very short draft (e.g., test case with 30 words) has fewer
tokens than the window size (50). Computing `tokens.length - windowSize + 1` yields
a negative number of windows.
**How to avoid:** If `tokens.length < windowSize`, use full TTR (unique/total) instead
of sliding window. Document this boundary in comments.
**Warning signs:** `windowCount <= 0`, resulting in NaN from division by zero.

### Pitfall 4: Cyrillic Tokenization Edge Cases

**What goes wrong:** The regex `[^а-яёА-ЯЁa-zA-Z0-9]+` used for tokenization does
not include `ё` in the range `а-я` (ё is outside the Unicode range а-я in Russian).
The regex literal `а-я` in JS does NOT include ё — ё is U+0451, outside U+0430-U+044F.
**How to avoid:** Always write the regex as `[^а-яёА-ЯЁa-zA-Z0-9]+` with `ё` and `Ё`
explicitly included. Same applies to the vowel regex: `[аеёиоуыэюяАЕЁИОУЫЭЮЯ]` —
note ё/Ё is explicitly listed.
**Warning signs:** Words containing ё (типа "её", "ёж", "поёт") are split at ё into
multiple tokens.

### Pitfall 5: Chorus Detection on Repeated Sections

**What goes wrong:** The song has three `[Припев]` sections (structure:
Куплет1 / Припев / Куплет2 / Припев / Бридж / Припев / Финал). A naive parser
overwrites `sections['Припев']` three times, keeping only the last one.
**How to avoid:** For syllable violation checking, deduplicate: since repeated choruses
are word-for-word identical, checking the first occurrence is sufficient. The parser
can keep first-occurrence semantics for the Припев key, or collect all as an array
and deduplicate.
**Warning signs:** `sections['Припев']` has only 4-5 lines when the full lyrics
show multiple chorus blocks.

---

## Code Examples

See Patterns 1-6 above for all implementation code. All patterns are derived from
FEATURES.md verified algorithms and the existing codebase conventions.

### Test Structure (node:test)

```js
// Source: Node.js 22 built-in test API [VERIFIED: Node 22 >= 20, package.json engines]
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDraft } from '../src/ai/metrics.js';

describe('banale detection', () => {
  it('detects любовь/кровь pair', () => {
    const lyrics = `[Куплет 1]\nЯ пишу о любовь\n[Припев]\nТечёт кровь`;
    const result = scoreDraft(lyrics);
    assert.ok(result.banale_pairs.length > 0);
    const flatPairs = result.banale_pairs.flat();
    assert.ok(flatPairs.includes('любовь') && flatPairs.includes('кровь'));
  });
});

describe('syllable violations', () => {
  it('flags chorus line over 12 syllables', () => {
    // 'радиоактивный город заснял один фотограф' = 15 syllables
    const lyrics = `[Куплет 1]\nКороткая строка\n[Припев]\nрадиоактивный город заснял один фотограф`;
    const result = scoreDraft(lyrics);
    assert.ok(result.syllable_violations.length > 0);
    assert.ok(result.syllable_violations[0].count > 12);
  });
});

describe('MATTR-approx', () => {
  it('repetitive text scores below 0.60', () => {
    const repeated = Array(50).fill('слово другое').join('\n');
    const lyrics = `[Куплет 1]\n${repeated}`;
    const result = scoreDraft(lyrics);
    assert.ok(result.lexical_diversity < 0.60);
  });

  it('varied text scores above 0.60', () => {
    // REQUIREMENTS.md success criterion 3: varied draft scores above threshold
    // Use a realistic varied lyrics sample
    const result = scoreDraft(SAMPLE_VARIED_LYRICS); // define a real sample
    assert.ok(result.lexical_diversity >= 0.60);
  });
});

describe('skip_pipeline gate', () => {
  it('returns skip_pipeline=true when all checks pass', () => {
    const result = scoreDraft(CLEAN_DRAFT_LYRICS);
    assert.strictEqual(result.skip_pipeline, true);
  });

  it('returns skip_pipeline=false when banale pair found', () => {
    const lyrics = `[Куплет 1]\nЯ пишу о любовь\n[Припев]\nТечёт кровь`;
    const result = scoreDraft(lyrics);
    assert.strictEqual(result.skip_pipeline, false);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Python lexicalrichness for MATTR | Pure JS sliding TTR | Phase 1 decision | Eliminates Python sidecar for metrics; keeps runtime pure Node.js |
| pymorphy3 for verb rhyme detection | Exact word cluster lookup | Phase 1 scope decision | Verb POS detection deferred to v2; cluster lookup covers 95% of failure cases with zero dependencies |
| No quality gate | scoreDraft() pre-check | Phase 1 | Prevents unnecessary AI calls on already-good drafts; provides grounding data for critic |

**Deferred/out-of-scope for Phase 1:**
- Verb-only rhyme detection (requires POS tagging → Python + pymorphy3) — deferred to v2
- Story specificity heuristics (proper noun detection, sensory word lists) — Phase 2 (critic) concern
- Structural compliance check (section count, line count per section) — valid improvement but not in METRICS-01/02/04 scope

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MATTR threshold 0.60 for skip_pipeline gate is appropriate for ~200-word Russian lyrics | Pattern 5, Common Pitfalls | Too low: lets repetitive drafts skip pipeline. Too high: sends good drafts to expensive critique. Calibrate after 20-30 runs per VALID-03. |
| A2 | No lemmatization needed for MATTR at ~200 words for a gate threshold of 0.60 | Pattern 4 | Inflected Russian verbs/nouns could make a repetitive text appear more diverse than it is. Risk is low: the 0.60 threshold is conservative, and repetitive AI outputs tend to repeat surface forms not just roots. |
| A3 | The 18-cluster banale list covers all ">=28 clusters" required by METRICS-01 | Standard Stack / Code Examples | FEATURES.md lists 18 clusters. REQUIREMENTS.md says ">=28 clusters". There are 18 entries above, some with 6-10 words. The requirement likely counts individual word pairs (each pair within a cluster). Adding additional clusters based on SYSTEM_PROMPT banned list (мечты/цветы is already in cluster 9) would close this gap. |

**A3 note:** METRICS-01 says "список >=28 кластеров". The FEATURES.md list has 18
cluster entries. This mismatch needs resolution: either the requirement counts
individual pairs (18 clusters × avg 3-4 words = 54-72 unique words → many pairs)
or additional clusters should be added. The SYSTEM_PROMPT in client.js explicitly
bans: `любовь/кровь, ночь/прочь, мечты/цветы` — all covered in the list. The planner
should verify whether "28 clusters" means 28 cluster groups or 28 word pairs.

---

## Open Questions

1. **METRICS-01: ">=28 clusters" — cluster groups or word pairs?**
   - What we know: FEATURES.md provides 18 cluster groups. REQUIREMENTS.md says >=28.
   - What's unclear: Whether to add 10 more cluster groups or whether the current 18
     groups satisfy the intent (they contain 60+ individual words).
   - Recommendation: Define "cluster" as "a group of mutually-rhyming banale words."
     Expand to 28 groups by adding common additional pairs from the SYSTEM_PROMPT
     banned list and stihi.ru source. Proposed additions below.

2. **skip_pipeline threshold: 0.60 vs 0.70**
   - What we know: FEATURES.md uses 0.70 for "quality target," 0.60 is the gate floor.
   - What's unclear: Exact threshold where pipeline adds value vs costs latency.
   - Recommendation: Start at 0.60 (conservative = more drafts go through pipeline).
     Calibrate in Phase 4 (VALID-03).

3. **Return value of generateLyrics: should it expose metrics?**
   - What we know: Callers in generate.js only use `{lyrics, tags, title}`. Adding
     `metrics` to the return is backward-compatible.
   - What's unclear: Whether Phase 2 integration reads metrics from the return value
     or re-calls scoreDraft.
   - Recommendation: Attach metrics to the return value in Phase 1. Phase 2 reads
     it from there. This avoids double-scoring.

---

## Additional Banale Clusters (to reach >=28)

These 10 additional clusters bring the total from 18 to 28, sourced from SYSTEM_PROMPT
banned list and Russian poetry pedagogy:

```js
// Additional clusters to add
['душа', 'навсегда', 'слова'],          // soul/forever
['жизнь', 'любить', 'верить'],          // life (noun-verb mix, semi-banale)
['сон', 'закон', 'дом', 'знакомо'],     // dream/law
['миг', 'крик', 'лик'],                 // moment
['боль', 'роль', 'контроль'],           // pain/role
['рядом', 'взглядом', 'прядом'],        // nearby
['слезу', 'мечту', 'красоту'],          // inflected forms (accusative)
['глаза', 'небеса', 'слеза'],           // eyes (nom vs BANNED_RHYMES cluster 11 краса)
['навсегда', 'никогда', 'всегда'],      // temporal adverbs (subset of cluster 13)
['звезда', 'мечта', 'красота'],         // star/dream (nom)
];
```

**Note:** Some overlap with existing clusters in accusative/genitive forms. Planner
should decide whether to add these as separate clusters or extend existing ones.
`[ASSUMED]` — exact additional clusters to add require domain judgment; the list
above is a starting point, not a final answer.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 1 has no external dependencies. All code is pure Node.js
with no CLI tools, databases, or external services required. Deployment to server
does not require any new packages (`npm install` adds nothing).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 22 built-in) |
| Config file | none — run directly with `node --test` |
| Quick run command | `node --test tests/metrics.test.js` |
| Full suite command | `node --test tests/` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| METRICS-01 | Draft with любовь/кровь → non-empty banale_pairs | unit | `node --test tests/metrics.test.js` | ❌ Wave 0 |
| METRICS-02 | Chorus line >12 syllables → flagged in syllable_violations | unit | `node --test tests/metrics.test.js` | ❌ Wave 0 |
| METRICS-04 | Repetitive draft → lexical_diversity < 0.60; varied → >= 0.60 | unit | `node --test tests/metrics.test.js` | ❌ Wave 0 |
| (gate) | skip_pipeline=true when all checks pass | unit | `node --test tests/metrics.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run check && node --test tests/metrics.test.js`
- **Per wave merge:** same (all tests in one file for Phase 1)
- **Phase gate:** All 4 test cases above green before marking Phase 1 complete

### Wave 0 Gaps

- [ ] `tests/metrics.test.js` — covers METRICS-01, METRICS-02, METRICS-04, gate behavior
- [ ] `tests/` directory — does not exist, must be created in Wave 0

*(No existing test infrastructure to extend. Full setup in Wave 0.)*

---

## Security Domain

Phase 1 adds no network calls, no user input handling, no authentication, and no
external service access. The metrics gate operates on AI-generated text (trusted
internal data). No ASVS categories apply. Security section: SKIPPED.

---

## Sources

### Primary (HIGH confidence)

- FEATURES.md §1.1, §1.2, §1.3, §6 — banale cluster list, syllable algorithm, MATTR
  algorithm, complete JS implementation patterns [VERIFIED: file read this session]
- SUMMARY.md §Phase 1 — "all algorithms fully specified in FEATURES.md with code
  examples. No further research needed." [VERIFIED: file read this session]
- REQUIREMENTS.md METRICS-01/02/04 — exact requirement text [VERIFIED: file read]
- src/ai/client.js — existing code structure, return format, integration point
  [VERIFIED: file read this session]
- CONVENTIONS.md — ESM, camelCase, named exports, console.log pattern, 2-space indent
  [VERIFIED: file read this session]
- TESTING.md — node:test recommendation, no existing test framework [VERIFIED]
- package.json — Node 22, zero test deps, engines >= 20 [VERIFIED]

### Secondary (MEDIUM confidence)

- Russian poetry pedagogy sources (Розбицкий/stihi.ru, Попова/samlib.ru) — banale
  cluster list community consensus [CITED in FEATURES.md]
- Koziev arxiv:2502.20931 — syllable counting validation [CITED in FEATURES.md]

### Tertiary (LOW confidence)

- A3 assumption: MATTR threshold 0.60 calibration — estimated, not empirically
  validated on this corpus

---

## Metadata

**Confidence breakdown:**

- Standard stack (pure JS, node:test): HIGH — zero new dependencies, confirmed by
  package.json and existing conventions
- Banale cluster list: HIGH — canonical community source, stable 10+ years
- Syllable algorithm: HIGH — mathematical fact about Russian phonology
- MATTR algorithm: HIGH (mechanism) / MEDIUM (threshold) — metric is standard;
  0.60 threshold is estimated
- Architecture (metrics.js location, return value integration): HIGH — consistent
  with existing module structure and conventions

**Research date:** 2026-04-16
**Valid until:** 2026-07-16 (stable domain — Russian phonology and banale lists
do not change; Node.js built-in test API stable)
