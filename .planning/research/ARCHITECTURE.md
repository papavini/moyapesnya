# Architecture Patterns: LLM Creative Writing Pipeline

**Domain:** Multi-step AI pipeline for Russian song lyric generation
**Researched:** 2026-04-16
**Confidence:** HIGH for pipeline pattern, MEDIUM for iteration count, MEDIUM for model assignment

---

## Recommended Architecture: Generate → Critique → Rewrite (single pass)

**Pattern:** One generate call, one critique call, one rewrite call. No loops.

```
[User input]
    │
    ▼
[Generator] ──► draft lyrics
    │
    ▼
[Critic] ──► structured critique (5 scored dimensions)
    │
    ▼
[Rewriter] ──► final lyrics
    │
    ▼
[JSON output: {lyrics, tags, title}]
```

**Why this pattern and not the alternatives:**

### Why NOT generate×N → judge

Generate-N (produce 3-5 candidates, pick the best) has two fatal problems for this use case:

1. **Same failure mode, multiplied.** If the generator is systematically bad at specific things (cliché rhymes, hobby-list choruses), it produces N equally-bad outputs. A judge picks the "least bad" from a set of bad. Documented by the Self-Refine paper: 20% average improvement from iterative refinement vs. selection from candidates for creative tasks.

2. **Cost and latency scale linearly.** Three generate calls at 30s each = 90s before any improvement step. The project budget is 2-3 minutes total.

Generate-N is appropriate when you need diversity sampling (e.g., picking a tone), not when you need to fix systematic quality gaps.

### Why NOT multiple critique loops

Research (Self-Refine, 2023, Madaan et al.) shows 80% of the quality gain from iterative refinement happens in the first refinement pass. Further iterations produce diminishing returns and risk **self-bias amplification**: models in loop 2+ start defending their own earlier rewrites rather than continuing to improve.

A confirmed finding from ACL 2024 ("LLM Amplifies Self-Bias in Self-Refinement"): all tested LLMs exhibit measurable bias toward their own stylistic outputs during self-refinement, and this bias accumulates with iterations. One pass avoids this trap almost entirely.

**Practical ceiling:** The original Self-Refine paper used a max of 4 iterations. In creative writing (vs. code), 1-2 passes are the practical sweet spot. Beyond 2, the model starts "refinement theater" — making surface changes while the deep structural problems remain.

**Recommendation: exactly 1 critique + 1 rewrite pass.** This fits the 2-3 minute budget and captures nearly all the quality headroom.

### Why this pattern IS right for the problem

The core issue documented in `src/ai/client.js` and PROJECT.md is not that the generator is random — it's that the generator is **systematically safe**. Training alignment pushes LLMs toward statistically expected outputs: `любовь/кровь`, hobby-list verses, "сильный и крутой" praise. A critic that explicitly names these failures in a specific draft changes the rewriter's task from "generate a song" to "fix these specific problems." That's a fundamentally different, harder-to-evade constraint.

---

## Critic Prompt Structure

The critic must score 5 dimensions, provide concrete evidence from the draft, and give a single rewrite instruction per dimension that fails. Generic feedback ("make it more emotional") does not work — the rewriter must receive specific actionable problems.

### The 5 Dimensions

**1. Story Specificity (0-3)**
- 0: Pure hobby list. No scene, no moment, no person visible behind the facts.
- 1: Has a setting but no story arc or payoff.
- 2: Has a scene but it could apply to many people.
- 3: Has at least one moment that is unmistakably THIS person — a specific action, contradiction, or image that the recipient would laugh recognizing.

*Failure evidence pattern:* Quote the verse that is most list-like. Name what is absent (when does this happen? what does the person do with their hands? what does someone say?).

**2. Chorus Identity (0-3)**
- 0: Chorus is hobby list + compliments. Fails the "remove the name" test.
- 1: Chorus has an image but it is generic ("едет вперёд", "смотрит в даль").
- 2: Chorus has one specific image but could be improved.
- 3: Chorus passes the identity test — one specific image or phrase that belongs only to this person.

*Failure evidence pattern:* Apply the remove-name test explicitly. "If I remove [Name] from this chorus, does it still describe a specific person? Result: [yes/no, quote evidence]."

**3. Rhyme Quality (0-3)**
- 0: Two or more banned rhyme pairs present (любовь/кровь, ночь/прочь, мечты/цветы, идёт/поёт pattern).
- 1: No banned pairs, but rhymes are all single-vowel identical endings (weak).
- 2: Mixed quality — some lazy verb rhymes, some good.
- 3: All rhymes are consonant-cluster matches or semantically unexpected pairs.

*Failure evidence pattern:* List every rhyme pair used. Mark each as [BANNED], [WEAK], or [GOOD].

**4. Singability / Syllable Fit (0-3)**
- 0: Chorus lines exceed 12 syllables. Verses vary more than ±3 syllables between lines.
- 1: Chorus is within limits, but meter is irregular — some lines feel rushed, others stretched.
- 2: Mostly consistent with minor issues.
- 3: Every chorus line 8-12 syllables, stress falls naturally, no filler words used to pad.

*Failure evidence pattern:* Count syllables in the chorus lines. Mark any line over 12. Count syllables in each verse line, flag any pair with >3 variance.

**5. Emotional Honesty (0-3)**
- 0: Emotions stated as labels only ("грустный", "весёлый", "счастливый").
- 1: One scene that creates feeling, rest is labels.
- 2: Two or more scenes that create feeling, minor label usage.
- 3: No emotional labels — all feeling conveyed through action, image, or dialogue.

*Failure evidence pattern:* Quote every emotion-label word (adjectives, adverbs, abstract nouns describing states). Count them.

### Critic Output Format

```json
{
  "scores": {
    "story_specificity": 0,
    "chorus_identity": 0,
    "rhyme_quality": 0,
    "singability": 0,
    "emotional_honesty": 0
  },
  "total": 0,
  "evidence": {
    "story_specificity": "string: quoted evidence + what is missing",
    "chorus_identity": "string: remove-name test result + quote",
    "rhyme_quality": "string: all rhyme pairs labeled BANNED/WEAK/GOOD",
    "singability": "string: syllable counts for all chorus lines",
    "emotional_honesty": "string: all emotion-label words quoted"
  },
  "rewrite_instructions": [
    "Instruction only for dimensions scoring 0 or 1"
  ]
}
```

**Threshold:** If total score ≥ 12 (average 2.4+), skip rewrite and return the draft. This avoids unnecessary latency when the first draft is already good.

---

## Number of Iterations

**Recommendation: 1 critique pass, 0 or 1 rewrite. No loop.**

Evidence basis:
- Self-Refine (NeurIPS 2023): 80% of gains in pass 1. Loops 2-4 add <5% each with diminishing signal.
- ACL 2024 self-bias study: same-model loops amplify style bias, hurting diversity.
- Multi-agent poetry paper (Zhang et al., 2024): 4 agents × 4 iterations showed gains primarily in diversity (novelty n-grams), not in semantic quality. Relevant because this project has the inverse problem — not too little diversity but too much safe-average output.

**The skip condition is important.** On well-specified inputs (detailed wishes, clear occasion) the generator may score ≥12 on the first draft. Running the rewriter on an already-good draft risks "refinement regression" — introducing changes that score better on rubric but lose spontaneous warmth from the original.

---

## Model Assignment Strategy

### Same model for all three steps

**Recommendation: Use the same model (Gemini 2.5 Pro or Claude Opus 4.6) for all three roles.**

Rationale:

1. **The self-bias problem is mostly in loop scenarios.** A single critique→rewrite pass with the same model does not produce the compounding self-bias that multi-pass loops produce. The critic is evaluating a specific text it did not write in this session — it has no emotional investment.

2. **Cross-model critique requires prompt reengineering.** Different models have different output conventions, refusal patterns, and JSON compliance behavior. Using two different models doubles the surface area for parsing failures.

3. **Cost and latency.** Using Gemini 2.5 Pro for all three steps at current OpenRouter pricing ($1.25/$10 per million tokens) keeps total pipeline cost predictable. Mixing in Claude Opus ($5/$25) for the critic step adds 4× per-token cost for the step with the smallest output.

4. **Verified by Self-Refine paper:** The original research explicitly used a single model as generator, critiquer, and refiner and achieved the ~20% improvement. Different-model critic is an enhancement, not a prerequisite.

**When different models DO make sense** (not needed now, monitor for later):
- If the same model consistently fails to critique its own cliché rhymes (self-blind spot). A stronger critic model (e.g., Claude Opus for critique when generator is Gemini) can catch patterns the generator cannot see in itself.
- If budget allows and you need critic precision on nuanced Russian phonetics.

### Confidence levels

| Recommendation | Confidence | Basis |
|---|---|---|
| Generate→Critique→Rewrite pattern | HIGH | Multiple papers confirm, matches the project's specific failure mode |
| Single pass, no loop | HIGH | Self-Refine paper quantified diminishing returns + self-bias study |
| 5-dimension critic rubric | MEDIUM | Derived from songwriting rubrics + WritingBench criteria + this project's documented failures; not directly validated on Russian-language song data |
| Skip condition at total ≥ 12/15 | MEDIUM | Reasonable threshold, should be calibrated empirically on first 20-30 outputs |
| Same model for all three steps | MEDIUM | Supported by Self-Refine; the self-bias concern is real but applies more strongly to multi-loop scenarios |
| Gemini 2.5 Pro as default model | LOW | Best available info on Russian creative writing quality; needs direct A/B testing against Claude Opus 4.6 |

---

## Single-Step Failure Modes (What Multi-Step Fixes)

Understanding exactly what breaks in single-step generation informs what the critic must catch:

**1. Statistical regression to mean.** Training pushes toward the most common token sequences. For Russian poetry this means `любовь/кровь` (the single most frequent rhyme pair in Russian pop lyrics training data) and generic praise vocabulary. Single-step generation has no mechanism to override this without explicit in-context examples — and the v11 prompt already has examples, hitting the ceiling.

**2. Prompt length dilution.** The v11 SYSTEM_PROMPT is 230+ lines. Research on LLM attention over long contexts (the "lost in the middle" problem) shows that instructions in the middle of a long prompt receive less attention than instructions at the start and end. The story/scene rules are buried in the middle — the model attends to them less than to the structural rules at the end.

**3. No explicit failure signal.** A single-step call succeeds as long as it returns valid JSON matching the schema. The model has no information about what specifically went wrong in its output. A critic provides that information directly: "line 3 of chorus is 16 syllables" or "rhyme pairs: идёт/зовёт = WEAK verb pair" is unambiguous.

**4. Over-compliance with format rules over quality rules.** The structural rules (line counts, syllable limits, JSON format) are hard, verifiable constraints. Story quality and emotional honesty are soft constraints. LLMs optimize harder for the verifiable subset. This creates technically compliant but emotionally empty outputs.

**5. Completion bias in finales.** Single-step generation must write the finale having already consumed context on all prior sections. The model reaches the finale in "completion mode" — wanting to close the task — which produces summary labels ("живой, настоящий") rather than returning to the opening image. The critic can flag this specifically.

---

## Implementation Architecture for src/ai/client.js

```
generateLyrics(input)
    │
    ├── 1. generate(input) → draft {lyrics, tags}
    │       model: gemini-2.5-pro, reasoning: high, temp: 1.0
    │       prompt: SYSTEM_PROMPT (unchanged, v11)
    │
    ├── 2. critique(draft, input) → {scores, total, evidence, instructions}
    │       model: same, reasoning: none (structured eval, no creativity needed)
    │       temp: 0.2 (deterministic scoring)
    │       prompt: CRITIC_PROMPT (see dimensions above)
    │       if total >= 12: skip step 3
    │
    └── 3. rewrite(draft, critique, input) → final {lyrics, tags}
            model: same, reasoning: medium (needs to fix specific problems)
            temp: 1.0 (creative)
            prompt: REWRITER_PROMPT
            instruction: "Here is the draft. Here is the critique. Fix ONLY the problems listed in rewrite_instructions. Do not change sections that scored 2 or 3."
```

**Key implementation detail:** The rewriter must receive the original draft alongside the critique, not just the critique. "Rewrite from scratch" loses the specific details and warmth of the draft. "Fix these specific problems" preserves what was working.

**Latency budget:**
- Step 1 (generate): ~25-40s (current baseline)
- Step 2 (critique): ~8-15s (smaller output, reasoning off)
- Step 3 (rewrite): ~20-35s (similar to generate)
- Total: ~55-90s, worst case ~120s. Within the 2-3 min budget.

---

## Architecture Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Critic scores consistently high (≥12), skipping rewrite on bad output | Medium | Calibrate threshold empirically; start at ≥12 and lower to ≥10 if pass rate is too high |
| Rewriter introduces new clichés while fixing old ones | Medium | Critic runs a second pass only on rewritten sections (not full second loop — just verify the specific dimensions that scored 0-1) |
| Critic JSON parse failure | Low | Same retry/fallback logic as current JSON parsing in client.js; if parse fails, return draft without rewrite |
| Same-model self-blind spot on rhymes | Medium | Explicit rhyme pair enumeration in critic prompt forces the model to list and label all pairs — makes the implicit explicit |
| Latency regression when both generate and rewrite are slow | Medium | Cap total pipeline at 150s; if step 1 takes >60s, return draft without critique (log for monitoring) |

---

## Sources

- Self-Refine: Iterative Refinement with Self-Feedback — Madaan et al., NeurIPS 2023: https://arxiv.org/abs/2303.17651
- LLM Amplifies Self-Bias in Self-Refinement — ACL 2024: https://aclanthology.org/2024.acl-long.826.pdf
- LLM-based multi-agent poetry generation in non-cooperative environments — Zhang et al., 2024: https://arxiv.org/abs/2409.03659
- WritingBench: A Comprehensive Benchmark for Generative Writing — 2025: https://arxiv.org/html/2503.05244v1
- Igniting Creative Writing in Small Language Models: LLM-as-a-Judge versus Multi-Agent Refined Rewards — 2025: https://arxiv.org/html/2508.21476v1
- Iterative Critique-Refine Framework for Enhancing LLM Personalization — 2025: https://arxiv.org/pdf/2510.24469
- Self-Correction & Iterative Refinement post (practical summary): https://prompton.wordpress.com/2025/06/20/self-correction-iterative-refinement/
- Art or Artifice? LLMs and the False Promise of Creativity: https://arxiv.org/html/2309.14556v3
