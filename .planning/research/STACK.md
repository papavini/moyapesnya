# Technology Stack — AI Model Selection for Russian Lyric Generation

**Project:** Подари Песню! — AI Poet Pipeline
**Researched:** 2026-04-16
**Scope:** Model comparison for Russian poetry / lyric generation via OpenRouter

---

## TL;DR Recommendation

**Use `google/gemini-2.5-flash` as the primary generator and `anthropic/claude-opus-4.6` (or Sonnet 4.6) as the critic.** Gemini 2.5 Flash has strong multilingual coverage, excellent Russian quality-to-cost ratio, and sufficient creative ability. Claude Opus 4.6 excels at nuanced critique and emotional writing but is too expensive to use for the full pipeline. o3 and DeepSeek V3.x are secondary options.

**Avoid using `anthropic/claude-opus-4.6` for generation** — $25/M output tokens makes it ~25–50x more expensive per generation than Gemini Flash, and the marginal quality gain for Russian lyrics specifically does not justify it.

---

## Ranked Model Recommendations

### Tier 1 — Recommended

#### 1. `google/gemini-2.5-flash` — Best Overall for This Use Case

| Property | Value |
|----------|-------|
| OpenRouter ID | `google/gemini-2.5-flash` |
| Input price | $0.30/M tokens |
| Output price | $2.50/M tokens |
| Est. cost per generation (200 words ~800 tokens output) | ~$0.002 |
| Context window | 1,048,576 tokens |
| Confidence | MEDIUM |

**Why:** Gemini 2.5 Flash has built-in reasoning ("thinking") capabilities, hits 95% multilingual accuracy including Russian in external testing, and is currently #1 on many Russian-language production benchmarks (Habr community tests, 2025). Critically, Google trained Gemini on more non-English data than Anthropic trained Claude — Claude is documented as ~90% English training data. Gemini 2.5 Flash is the "workhorse" version of the same model family that powers Gemini 2.5 Pro, with cost cut 4x.

**Russian-specific strengths:**
- Strong Slavic morphology coverage (100+ languages, Russian is a tier-1 language for Google)
- Handles complex Russian declension/conjugation in rhymes better than English-centric models
- "Thinking" mode helps it reason through syllable patterns before generating
- Consistently praised in Habr/Russian-community comparisons for Russian text quality

**Weaknesses:**
- Creative voice is more "professional" than "literary" — can feel polished but flat
- Occasional over-use of ellipses in creative output (documented weakness)
- Less emotionally daring than Claude Opus on creative risks

**Syllable counting:** Unreliable like all LLMs. Workaround: use chain-of-thought in prompt — force model to write syllable breakdown before each line. Thinking mode helps significantly.

---

#### 2. `anthropic/claude-opus-4.6` — Best for Critique Role

| Property | Value |
|----------|-------|
| OpenRouter ID | `anthropic/claude-opus-4.6` |
| Input price | $5/M tokens |
| Output price | $25/M tokens |
| Est. cost per critique (~600 tokens output) | ~$0.015 |
| Context window | 1,000,000 tokens |
| Confidence | HIGH |

**Why for critic, not generator:** Claude Opus 4.6 leads EQ-Bench Creative Writing leaderboard (Elo ~1932, April 2026). It produces "less AI-sounding text" than competitors, excels at emotional nuance, and can generate highly specific, personal narratives. However, its primary training is ~90% English — Russian quality, while functional, is not its strongest suit compared to multilingual-first models. For a critic role that reads a draft and identifies *specific* failures (wrong rhyme, flat emotion, clichéd lines), English-trained reasoning quality is fine.

**Use as:** Critic in generate→critique→rewrite pipeline. Generate a draft with Gemini Flash (cheap), have Claude Opus critique it (one short response, ~$0.01), then rewrite with Flash or Sonnet (cheap).

**Alternative:** `anthropic/claude-sonnet-4.6` ($3/M input, costs estimated from context) for a cheaper critique at slightly lower quality.

---

### Tier 2 — Viable Alternatives

#### 3. `openai/o3` — Best Structural Compliance

| Property | Value |
|----------|-------|
| OpenRouter ID | `openai/o3` |
| Input price | $2/M tokens |
| Output price | $8/M tokens |
| Est. cost per generation (800 tokens output) | ~$0.006 |
| Context window | 200,000 tokens |
| Confidence | MEDIUM |

**Why:** o3 is a reasoning model trained specifically to reduce errors on complex multi-step tasks — 20% fewer major errors than o1. For Russian lyrics, the structural constraint problem (syllable counts, ABAB rhyme scheme across 6 stanzas) benefits from explicit reasoning. o3 would "plan" the structure before generating, making it more reliable for following strict structural rules.

**Weaknesses:**
- Reasoning models are notoriously dry and technical in creative output — writes "correct" lyrics but they feel algorithmic
- o4-mini is **not recommended** — documented as falling short on creative writing quality, better for STEM
- Russian quality MEDIUM confidence — strong multilingual but not specifically tested
- 3x more expensive than Gemini Flash for same output

**Best use case:** Rewrite step in pipeline when strict syllable/rhyme compliance is critical.

---

#### 4. `google/gemini-2.5-pro` — Highest Quality, High Cost

| Property | Value |
|----------|-------|
| OpenRouter ID | `google/gemini-2.5-pro` |
| Input price | $1.25/M tokens |
| Output price | $10/M tokens |
| Est. cost per generation | ~$0.008 |
| Context window | 1,048,576 tokens |
| Confidence | MEDIUM |

**Why:** This is what the project currently uses. Strong Russian quality (same family as Flash), better creative output than Flash, leads on many reasoning benchmarks. However, at 4x the cost of Flash with ~80% of the creative ceiling, it's harder to justify for high-volume use.

**Verdict:** Keep as fallback / A/B test target. If Gemini Flash quality proves insufficient, upgrade to Pro. Do not use as default given 4x cost difference.

---

#### 5. `deepseek/deepseek-v3.2` — Cheapest Viable Option

| Property | Value |
|----------|-------|
| OpenRouter ID | `deepseek/deepseek-v3.2` |
| Input price | $0.26/M tokens |
| Output price | $0.38/M tokens |
| Est. cost per generation | ~$0.0003 |
| Context window | 163,840 tokens |
| Confidence | LOW |

**Why potentially useful:** At $0.38/M output, DeepSeek V3.2 is ~6x cheaper than Gemini Flash and ~65x cheaper than Claude Opus. Community comparisons show DeepSeek as "undisputed winner in content generation" with compelling creative output in English. It supports Russian but Slavic language quality is UNCONFIRMED — no authoritative benchmark found.

**Critical weakness for this project:** DeepSeek context window (163K) is fine for lyrics, but the previous project experience showed `deepseek-v3.2` caused issues with OpenRouter model ID formatting (project history: "deepseek-v3-2 → deepseek-v3.2" ID confusion). Use exact ID `deepseek/deepseek-v3.2`.

**Verdict:** Worth A/B testing as ultra-cheap generator, but don't use in production without quality validation on Russian poetry specifically.

---

### Tier 3 — Not Recommended for This Use Case

#### `mistralai/mistral-large-2512` — Undercuts on Russian Creative Quality

| Property | Value |
|----------|-------|
| OpenRouter ID | `mistralai/mistral-large-2512` |
| Input price | $0.50/M tokens |
| Output price | $1.50/M tokens |
| Confidence | LOW |

**Why not:** Mistral Large 3 (2512) supports Russian as a named language, but its creative writing reputation is for "solid factual content" — not the emotionally-charged, story-driven lyric writing needed here. No strong community signal for Russian poetry quality. Price point is between Gemini Flash and Pro but without the Russian-first training advantage Google brings. Pass.

---

#### `qwen/qwen3-235b-a22b` — Technically Capable, Operationally Complex

| Property | Value |
|----------|-------|
| OpenRouter ID | `qwen/qwen3-235b-a22b` |
| Input price | (UNCONFIRMED — check openrouter.ai) |
| Confidence | LOW |

**Why not:** Qwen3-235B-A22B supports 100+ languages including Russian and has shown strong multilingual performance. However: (1) no specific Russian poetry quality data found, (2) Chinese-English primary training means Russian is a third-order language, (3) MoE routing can produce inconsistent output quality. Interesting for future experiments but not the safe choice for a production bot serving paying customers.

---

#### Russian-native models (GigaChat, YandexGPT) — Not on OpenRouter

**GigaChat** (Sber) and **YandexGPT 5.1** are not available via OpenRouter. They require separate Russian-market APIs (rubles, Sber Cloud / Yandex Cloud), different integration work, and add another dependency. For a Node.js bot that already uses OpenRouter, this adds significant operational complexity. The quality advantage they bring (native Russian cultural understanding, slang, humor) is real but not worth the integration cost at this stage.

---

## Cost Comparison Table

Assumptions: Generation = ~500 tokens input (prompt + user data) + ~800 tokens output (lyrics ~200 words in Russian). Critique = ~1500 tokens input + ~600 tokens output.

| Model | OpenRouter ID | Input $/M | Output $/M | Gen cost | Critique cost | Total (gen+critique) |
|-------|--------------|-----------|------------|----------|---------------|----------------------|
| Gemini 2.5 Flash | `google/gemini-2.5-flash` | $0.30 | $2.50 | $0.0021 | $0.0020 | **$0.004** |
| DeepSeek V3.2 | `deepseek/deepseek-v3.2` | $0.26 | $0.38 | $0.0004 | $0.0004 | **$0.001** |
| Mistral Large 3 | `mistralai/mistral-large-2512` | $0.50 | $1.50 | $0.0013 | $0.0011 | $0.002 |
| Gemini 2.5 Pro | `google/gemini-2.5-pro` | $1.25 | $10.00 | $0.0086 | $0.0066 | $0.015 |
| o3 | `openai/o3` | $2.00 | $8.00 | $0.0071 | $0.0056 | $0.013 |
| Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | ~$3.00 | ~$15.00 | ~$0.013 | ~$0.010 | ~$0.023 |
| Claude Opus 4.6 | `anthropic/claude-opus-4.6` | $5.00 | $25.00 | $0.0215 | $0.016 | **$0.037** |

**Recommended pipeline cost: ~$0.005–$0.006** (Flash generate + Sonnet critique)
Compare to current: ~$0.008–0.012 (Gemini 2.5 Pro single-step with reasoning:high)

---

## Architecture Recommendation: Hybrid Pipeline

```
User input (occasion, genre, mood, voice, wishes)
        ↓
[Step 1: GENERATE]  google/gemini-2.5-flash  (thinking mode ON)
  Prompt: full poet v11 prompt
  Output: draft lyrics JSON {lyrics, tags, title}
  Cost: ~$0.002
        ↓
[Step 2: CRITIQUE]  anthropic/claude-sonnet-4.6  (no reasoning needed)
  Prompt: "You are a harsh Russian poetry editor. Identify:
    1. Clichéd rhymes (любовь/кровь type)
    2. Lines that could apply to anyone (not specific to this person/occasion)
    3. Syllable-heavy lines that will be hard to sing
    4. Missing emotional peaks
    Output: JSON {issues: [...], rewrite_guidance: '...'}"
  Cost: ~$0.002
        ↓
[Step 3: REWRITE]  google/gemini-2.5-flash  (thinking mode ON)
  Prompt: original context + draft + critique → "Fix the identified issues"
  Output: final lyrics JSON
  Cost: ~$0.002
        ↓
SUNO custom_generate
```

**Total latency:** Flash ~15–25s + Sonnet ~8–15s + Flash ~15–25s = **~40–65 seconds**
Well within the 2–3 minute budget.

**Total cost:** ~$0.006 per generation (vs current ~$0.010)

---

## Russian Morphology and Rhyme: What Models Can and Can't Do

**All LLMs fail at syllable counting** — this is a fundamental tokenization problem. Russian words like "праздновать" (3 syllables but tokenizes into multiple subword pieces) are impossible for the model to count reliably at the generation stage. The workaround is CoT: force the model to write syllables explicitly before the line, e.g.:

```
Thinking step (in prompt): "For each line, first write the syllable breakdown in parentheses, then write the line. Example: (же-ла-ю-счас-тья=5) → Желаю счастья от души"
```

Reasoning models (Gemini 2.5 Flash thinking mode, o3) handle this significantly better because they produce intermediate steps before final output.

**Rhyme quality in Russian** is harder than English because Russian has 6 grammatical cases + aspect pairs producing many "easy" rhymes that sound cheap (любовь/кровь, цветы/мечты). Claude Opus 4.6 is best at avoiding these due to stronger English creative writing training that transfers to "quality" judgment. Use it as the critic role.

**Morphological accuracy** (correct grammatical agreement in rhyming words) — Gemini models are stronger here due to more Russian training data. Claude has been documented as less reliable on non-English grammar edge cases.

---

## Key Technical Notes for Implementation

1. **Gemini 2.5 Flash thinking mode:** Enable with `include_reasoning: true` or equivalent OpenRouter parameter. Check OpenRouter docs for exact syntax — may differ from direct Google API.

2. **Model ID for current production:** The CONTINUITY.md shows `google/gemini-2.5-pro` is currently used. Migration path: swap to `google/gemini-2.5-flash` in `src/ai/client.js` as the first experiment.

3. **OpenRouter DeepSeek IDs are fragile** — project history documents `deepseek-v3-2` vs `deepseek-v3.2` confusion. Always verify exact IDs at openrouter.ai/models before deploying.

4. **Claude Sonnet 4.6 ID on OpenRouter:** `anthropic/claude-sonnet-4-6` (with hyphen before 4, not dot) — verify this against current listing as Anthropic naming conventions have shifted.

5. **Response format:** DeepSeek does not support `response_format: {type: "json_object"}` (project history, April 2025). Always test new models for JSON output compliance.

---

## Confidence Assessment

| Area | Confidence | Source |
|------|------------|--------|
| Gemini 2.5 Flash pricing ($0.30/$2.50) | HIGH | OpenRouter direct listing confirmed via multiple sources |
| Claude Opus 4.6 pricing ($5/$25) | HIGH | OpenRouter direct listing confirmed via multiple sources |
| o3 pricing ($2/$8) | HIGH | OpenRouter direct listing |
| Mistral Large 3 pricing ($0.50/$1.50) | HIGH | OpenRouter direct listing |
| DeepSeek V3.2 pricing ($0.26/$0.38) | HIGH | OpenRouter direct listing |
| Gemini 2.5 Pro pricing ($1.25/$10) | HIGH | OpenRouter direct listing |
| Gemini Russian language superiority over Claude | MEDIUM | Hacker News community, Habr benchmarks, known training data distribution; no formal Russian poetry benchmark |
| Claude Opus creative writing leadership (English) | HIGH | EQ-Bench leaderboard (Elo ~1932), multiple review sources |
| All LLMs unreliable on syllable counting | HIGH | PhonologyBench benchmark (45% gap vs humans), multiple technical sources |
| o3 better structural compliance vs creative quality | MEDIUM | OpenAI vibe check article, community testing |
| DeepSeek V3.2 Russian poetry quality | LOW | No Russian-specific poetry data found; general creative quality documented |
| Qwen 3 Russian quality | LOW | Language support confirmed, quality UNCONFIRMED |

---

## Sources

- [OpenRouter Gemini 2.5 Flash pricing](https://openrouter.ai/google/gemini-2.5-flash)
- [OpenRouter Claude Opus 4.6 pricing](https://openrouter.ai/anthropic/claude-opus-4.6)
- [OpenRouter o3 pricing](https://openrouter.ai/openai/o3)
- [OpenRouter Mistral Large 3 2512](https://openrouter.ai/mistralai/mistral-large-2512)
- [OpenRouter DeepSeek V3 / chat](https://openrouter.ai/deepseek/deepseek-chat)
- [EQ-Bench Creative Writing Leaderboard](https://eqbench.com/creative_writing.html)
- [PhonologyBench — syllable counting gap](https://arxiv.org/abs/2404.02456)
- [Automated Evaluation of Meter and Rhyme in Russian Poetry](https://arxiv.org/html/2502.20931v1)
- [Generation of Russian Poetry with LLMs (ACL 2025)](https://aclanthology.org/2025.latechclfl-1.6/)
- [Hacker News: Claude sucks at non-English languages](https://news.ycombinator.com/item?id=46905227)
- [Habr: LLM production for Russian content, 18 models tested](https://habr.com/ru/articles/1021388/)
- [Claude vs ChatGPT for Russian (2026)](https://rephrase-it.com/blog/claude-vs-chatgpt-for-russian-in-2026)
- [Gemini 2.5 Pro creative writing assessment](https://4idiotz.com/tech/artificial-intelligence/gemini-2-5-pro-creative-writing-assessment-2025-tips-examples-insights/)
- [OpenAI o3/o4-mini vibe check for creative writing](https://every.to/context-window/vibe-check-openai-s-o3-gpt-4-1-and-o4-mini)
- [OpenRouter cost calculator](https://costgoat.com/pricing/openrouter)
