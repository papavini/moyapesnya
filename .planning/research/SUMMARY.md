# Project Research Summary

**Project:** Podari Pesnyu! AI Poet Pipeline (Generate -> Critique -> Rewrite)
**Domain:** Multi-step LLM pipeline for Russian personalized song lyric generation
**Researched:** 2026-04-16
**Confidence:** HIGH (pipeline pattern, pitfalls), MEDIUM (model selection, metric thresholds)

---

## Executive Summary

The core problem is well-diagnosed: the existing single-step Gemini 2.5 Pro generator hits a quality ceiling because LLMs are systematically pulled toward statistically probable tokens. This is the cliche gravity effect: models generate the most probable token sequence. In Russian song lyrics the most probable tokens after lyubov are krov, vnov, slov. No amount of prompt iteration fully overrides this, as v11 demonstrates. The research consensus points to one solution: a Generate->Critique->Rewrite (G->C->R) pipeline with exactly one critique pass and one conditional rewrite. This pattern is validated by the Self-Refine paper (NeurIPS 2023): 80% of quality gains land in the first refinement pass, with diminishing and potentially harmful returns in subsequent loops.

The recommended implementation uses google/gemini-2.5-flash (thinking mode on) as generator and rewriter, and anthropic/claude-sonnet-4.6 as the critic. Flash provides strong Russian morphology coverage and costs approximately USD 0.002 per generation. Sonnet 4.6 brings the cross-model perspective that breaks the same-model echo chamber pitfall and adds approximately USD 0.002 per critique. Total pipeline cost approximately USD 0.005-0.006 versus current approximately USD 0.010. The rewrite is gated: if the draft scores >=12/15 on the five-dimension rubric, it ships without rewrite. Estimated total latency: 40-90 seconds, within the 2-3 minute budget.

The three risks that can make the pipeline actively worse than single-step: (1) same-model echo chamber in the critique step, mitigated by using Sonnet as critic; (2) sycophantic cosmetic rewrites, mitigated by requiring >20% token diff and explicit KEEP/REWRITE section verdicts; (3) instruction drift in the rewrite step, mitigated by repeating all hard constraints at top and bottom of the rewrite prompt. The pipeline should also gate at entry: if the first draft passes all measurable checks (no banned rhymes, chorus <=12 syllables, at least one proper noun), skip the critique entirely.

---

## Key Findings

### Recommended Stack

The model decision is split by role, not cost alone. Flash (generator/rewriter) wins on Russian language quality and cost. Sonnet (critic) wins on analytical precision and cross-model perspective. Current production model Gemini 2.5 Pro is a viable fallback for generation but at 4x the cost should not be the default.

**Core technologies:**
- google/gemini-2.5-flash: generator and rewriter. Best Russian quality-to-cost ratio, thinking mode handles syllable reasoning, approx USD 0.002/generation
- anthropic/claude-sonnet-4.6: critic. Cross-model perspective breaks echo chamber, strong structured JSON output, approx USD 0.002/critique
- pymorphy3 (Python): morphological analysis for POS-based rhyme flagging and lemmatization
- RussianPoetryScansionTool (Python, MIT): stress-aware rhyme detection, validated r=0.79 against human annotation
- Python sidecar script score_lyrics.py: called from Node.js via child_process.spawn, target <500ms

**Critical ID notes:**
- OpenRouter generator ID: google/gemini-2.5-flash
- OpenRouter critic ID: anthropic/claude-sonnet-4-6 (hyphen before 4, verify at openrouter.ai -- naming has shifted)
- DeepSeek IDs are fragile on OpenRouter -- always verify exact string before deploying
- Gemini 2.5 Flash thinking mode: enable via include_reasoning:true -- verify exact OpenRouter parameter syntax before implementation

### Expected Features (Metrics to Build)

The evaluation system has three tiers: programmatic (fast, deterministic), LLM-judge (the critic pass), and human rubric (A/B validation). All three are needed; none is sufficient alone.

**Must have (table stakes -- gates the pipeline):**
- Banale rhyme detection: 19-cluster lookup + verb-only POS check; implementable in pure JS with the cluster list from FEATURES.md
- Syllable count per line: vowel-count regex on Russian text; trivially portable to JS; gates chorus compliance (max 12 syllables)
- Structural compliance: section presence, line counts, chorus repetition; deterministic; must always pass before SUNO submit

**Should have (drives critic quality):**
- 5-dimension LLM critic rubric (Story Specificity, Chorus Identity, Rhyme Quality, Singability, Emotional Honesty): each 0-3, JSON output, evidence quotes, targeted rewrite instructions for failing dimensions only
- Specificity heuristic (proper nouns + time expressions + sensory nouns vs abstract adjective labels): fast proxy augmenting the LLM critic
- KEEP/IMPROVE/REWRITE section verdict in critic output: prevents sycophantic wholesale destruction of good sections

**Defer to v2+:**
- MATTR vocabulary diversity scoring (requires Python + pymorphy3 -- adds overhead)
- Audio-based metrics post-SUNO render
- BERT-Score or BLEU (wrong metric class -- no reference text exists)
- Custom quality model training (requires 1000+ annotated examples)

### Architecture Approach

The pipeline is a linear three-step chain with a conditional skip at step 2->3. No loops. Each step gets its own complete system prompt. Context from prior steps is passed as structured data, not inherited via conversation history, to avoid instruction drift. The rewriter receives the original draft plus the critic structured JSON to preserve what worked while fixing specific failures.

**Major components:**
1. Generator: client.js step 1, Gemini 2.5 Flash + thinking mode ON + temp 1.0, current v11 SYSTEM_PROMPT unchanged, outputs draft {lyrics, tags, title}
2. Metrics gate: programmatic pre-check in Node.js. Banale rhyme lookup + syllable count + structural check. Pass -> output. Fail -> invoke critic.
3. Critic: client.js step 2, Sonnet 4.6 + temp 0.3 + no reasoning. 5-dimension rubric + evidence requirement + KEEP/IMPROVE/REWRITE verdicts + untrusted wishes wrapper. Outputs {scores, total, evidence, rewrite_instructions, keep_sections}.
4. Skip gate: if total >= 12/15 return draft directly. If total < 12 invoke rewriter.
5. Rewriter: client.js step 3, Gemini 2.5 Flash + thinking ON + temp 1.0. JSON format rules at start AND end. KEEP list passed explicitly. Critique embedded in the middle.
6. Latency cap: if step 1 >60s return draft without critique. If total pipeline >150s return best available and log.

Data flow:
  user_input -> [Generator] -> draft
  draft -> [Metrics gate] -> pass? -> output
                         -> fail? -> [Critic] -> critique
                                    total>=12? -> output draft
                                    total<12?  -> [Rewriter] -> final output

### Critical Pitfalls

1. Same-model echo chamber: If Gemini generates and Gemini critiques, the critic has the same cliche blind spots. Prevention: use Sonnet 4.6 as critic (different provider, different training distribution). Detection: critique shorter than 100 words or opens with approval phrasing.

2. Sycophantic cosmetic rewrite: RLHF-trained models perform compliance. They acknowledge the critique, swap a few tokens, return structurally identical text. Prevention: (a) forbid acknowledgment phrases in rewriter prompt; (b) require explanation of what specific lines changed; (c) measure string diff -- if <20% new tokens flag as failed rewrite. Detection: chorus word-for-word identical, same banned rhyme survives the rewrite.

3. Instruction drift in rewrite step: Hard constraints (JSON format, syllable limits) end up in the middle of a long context where attention degrades 30%+. Prevention: every hard constraint at TOP and BOTTOM of the rewrite system prompt. Original system prompt must be fully repeated -- no conversation inheritance. If total rewrite context >4000 tokens, compress critique to bullet points.

4. Critique calibration failure: Without explicit criteria, the critic applies poetry rubrics (metaphor richness, vocabulary sophistication) instead of song rubrics (singability, personalization). Prevention: numbered rubric with explicit yes/no questions; mark colloquial vocabulary as POSITIVE criterion; require the critic to identify at least 2 sections to KEEP.

5. Pipeline worse than single-step on good first drafts: When the first draft is already strong, the critic introduces noise. Prevention: programmatic metrics gate is the primary defense. If draft passes all measurable checks, skip the pipeline entirely.

---

## Implications for Roadmap

### Phase 1: Programmatic Metrics Gate
**Rationale:** Before building the multi-step pipeline, establish the quality measurement layer. Delivers: (1) a fast skip condition avoiding unnecessary LLM calls on good drafts; (2) grounding data the critic uses in its prompt. Without this, the critic must detect mechanically-detectable failures by inference -- slower and less reliable.
**Delivers:** score_lyrics.js with banale rhyme detection, syllable count per line, structural compliance. Output: {banale_pairs, syllable_violations, structure_ok, skip_pipeline}.
**Addresses:** Banale detection, syllable check, structural compliance -- all must-have features.
**Avoids:** Running pipeline on good drafts, cost explosion on already-good output.
**Research flag:** SKIP -- all algorithms fully specified in FEATURES.md with code examples. No further research needed.

### Phase 2: Critic Prompt and Integration
**Rationale:** With metrics gate in place, build the critic as a structured evaluation call. The critic receives the draft plus pre-computed metrics as grounding -- it articulates why failures matter and provides targeted rewrite instructions. Key architectural decision: programmatic detection + LLM articulation.
**Delivers:** CRITIC_PROMPT constant + critic call in client.js + JSON parse with fallback. Integration: if total >= 12, return draft; else proceed to Phase 3.
**Uses:** anthropic/claude-sonnet-4.6 at temp=0.3, no reasoning. Input: draft + pre-computed metrics + user input wrapped as untrusted.
**Avoids:** Same-model echo chamber (different provider), wrong criteria (explicit rubric), prompt injection (untrusted wrapper for wishes).
**Research flag:** CALIBRATE -- threshold >=12/15 needs empirical validation on first 20-30 outputs. Start at >=12 and adjust.

### Phase 3: Rewriter Prompt and Full Pipeline
**Rationale:** With a working critic, build the rewriter against a known input format. The rewriter fixes only sections scoring 0 or 1, preserves sections scoring 2 or 3. Simpler and more reliable than rewrite-from-scratch.
**Delivers:** REWRITER_PROMPT constant + rewriter call + full G->C->R flow in generateLyrics(). End-to-end latency logging. Fallback to draft on timeout or parse failure.
**Uses:** google/gemini-2.5-flash at temp=1.0 + thinking ON. Input: original draft + keep_sections + rewrite_instructions only (compress to bullets if context >4000 tokens).
**Avoids:** Sycophantic rewrite (no acknowledgment phrases, 20% diff check), instruction drift (JSON format rules at top AND bottom), reasoning cost explosion (critic does not use thinking mode).
**Research flag:** ITERATE -- rewriter prompt phrasing for fix-only-failing-sections needs 3-5 empirical versions before settling.

### Phase 4: A/B Validation and Threshold Calibration
**Rationale:** Run old (v11 single-step Gemini Pro) and new (G->C->R Flash/Sonnet/Flash) in parallel on same 10-15 test cases. Use the human evaluation rubric from FEATURES.md (10 criteria, 1-5 scale, minimum passing 35/50). Calibrate skip threshold and validate the pipeline actually improves quality.
**Delivers:** A/B test results table. Calibrated skip threshold. Go/no-go decision for production rollout.
**Avoids:** Deploying a cost-multiplying pipeline that adds no measured value.
**Research flag:** SKIP -- protocol is standard. Needs empirical execution, not more research.

### Phase Ordering Rationale

- Phase 1 before Phase 2: metrics gate provides grounding data for critic and skip condition. Without it, critic must detect mechanical failures by inference.
- Phase 2 before Phase 3: critic output format (keep_sections, rewrite_instructions) is the interface contract the rewriter depends on. Stabilize contract before building consumer.
- Phase 3 before Phase 4: pipeline must exist before it can be validated.
- Phase 1 delivers immediate standalone value (quality check on current single-step output) before the full pipeline is ready.

### Research Flags

Phases needing deeper research during planning:
- Phase 2 (Critic prompt): 5-dimension rubric is specified; scoring weights and skip threshold are estimated. Flag for calibration during Phase 4.
- Phase 3 (Rewriter): fix-only-failing-sections constraint needs prompt iteration. No published template -- plan empirical tuning.

Phases with standard patterns (skip research):
- Phase 1 (Metrics gate): all algorithms fully specified in FEATURES.md with code examples. Vowel-count syllabification is the correct approach for Russian.
- Phase 4 (A/B validation): human rubric is in FEATURES.md. Standard protocol (blind raters, Cohen kappa > 0.6, minimum 10 test cases).

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Pipeline pattern (G->C->R, single pass) | HIGH | Self-Refine NeurIPS 2023 + ACL 2024 self-bias study; directly matches this project failure mode |
| Pitfalls (echo chamber, sycophancy, drift) | HIGH | Multiple peer-reviewed sources; detection signals observable in existing codebase |
| Banale rhyme cluster list | HIGH | Canonical community sources (stihi.ru, samlib); stable for 10+ years |
| Syllable counting algorithm | HIGH | Russian vowel-syllable mapping is unambiguous; confirmed by every phonetics reference |
| Critic model choice (Sonnet 4.6) | MEDIUM | Cross-model critique rationale is solid; quality delta vs same-model needs empirical validation |
| Generator model choice (Flash vs Pro) | MEDIUM | Russian benchmark data is community-sourced (Habr); no formal Russian poetry benchmark for Flash |
| Skip threshold (>=12/15) | MEDIUM | Reasonable estimate; must be calibrated on first 20-30 outputs |
| MATTR thresholds for vocabulary diversity | MEDIUM | Metric is well-validated; thresholds for this text length/style are estimated |
| DeepSeek V3.2 Russian poetry quality | LOW | No Russian-specific poetry benchmark found; exclude from production until validated |

**Overall confidence:** MEDIUM-HIGH. Architectural decisions are grounded in peer-reviewed research. Model-specific and threshold decisions need empirical validation on actual output.

### Gaps to Address

- Flash thinking mode OpenRouter parameter: likely include_reasoning:true but needs verification against current OpenRouter docs before implementation.
- Claude Sonnet 4.6 OpenRouter ID: verify exact ID at openrouter.ai before deploying -- Anthropic naming conventions have shifted.
- Skip threshold calibration: after 20-30 pipeline runs, compute actual score distribution and set threshold from data.
- Rewrite diff measurement: the 20% new-token threshold for detecting sycophantic rewrites needs instrumentation and empirical adjustment.
- Python sidecar latency: target <500ms. Profile pymorphy3 initialization -- consider keeping the process warm.

---

## Sources

### Primary (HIGH confidence)
- Self-Refine: Iterative Refinement with Self-Feedback (Madaan et al., NeurIPS 2023): https://arxiv.org/abs/2303.17651
- LLM Amplifies Self-Bias in Self-Refinement (ACL 2024): https://aclanthology.org/2024.acl-long.826.pdf
- Lost in the Middle: How Language Models Use Long Contexts (TACL 2024): https://aclanthology.org/2024.tacl-1.9/
- Large Language Models Cannot Self-Correct Reasoning Yet (ICLR 2024): https://openreview.net/forum?id=IkmD3fKBPQ
- RussianPoetryScansionTool (MIT, validated r=0.79): https://github.com/Koziev/RussianPoetryScansionTool
- EQ-Bench Creative Writing Leaderboard: https://eqbench.com/creative_writing.html
- OpenRouter pricing: https://openrouter.ai/models

### Secondary (MEDIUM confidence)
- Automated Evaluation of Meter and Rhyme in Russian Poetry (arxiv:2502.20931): https://arxiv.org/html/2502.20931v1
- The Silicon Mirror: Anti-Sycophancy in LLM Agents (2025): https://arxiv.org/html/2604.00478
- Habr: LLM production benchmarks for Russian content, 18 models: https://habr.com/ru/articles/1021388/
- G-Eval framework: https://medium.com/@zlatkov/deep-dive-into-g-eval
- Banale rhyme lists: https://stihi.ru/2012/02/28/6826 and https://samlib.ru/p/popowa_a_r/rifmy.shtml

### Tertiary (LOW confidence -- needs validation)
- DeepSeek V3.2 creative quality (English community data only): no Russian poetry benchmark found
- OpenAI o3 vibe check for creative writing: https://every.to/context-window/vibe-check-openai-s-o3-gpt-4-1-and-o4-mini

---
*Research completed: 2026-04-16*
*Ready for roadmap: yes*