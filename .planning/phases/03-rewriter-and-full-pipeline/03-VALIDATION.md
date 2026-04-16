---
phase: 3
slug: rewriter-and-full-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22 built-in) |
| **Config file** | none — run directly with `node --test` |
| **Quick run command** | `node --test src/ai/pipeline.test.js` |
| **Full suite command** | `node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js` |
| **Estimated runtime** | ~30–60 seconds (API calls to OpenRouter) |

---

## Sampling Rate

- **After every task commit:** Run `npm run check && node --test src/ai/pipeline.test.js`
- **After every plan wave:** Run `node --test src/ai/metrics.test.js src/ai/critic.test.js src/ai/pipeline.test.js`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PIPELINE-01 | N/A | unit (skeleton) | `npm run check` | ❌ Wave 0 | ⬜ pending |
| 3-01-02 | 01 | 1 | PIPELINE-01, MODELS-01 | N/A | integration RED | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 | ⬜ pending |
| 3-02-01 | 02 | 1 | MODELS-01 | N/A | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 | ⬜ pending |
| 3-02-02 | 02 | 2 | PIPELINE-04 | N/A | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 | ⬜ pending |
| 3-03-01 | 03 | 2 | PIPELINE-01, PIPELINE-02 | N/A | integration | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 | ⬜ pending |
| 3-03-02 | 03 | 2 | PIPELINE-01 | N/A | integration (mock) | `node --test src/ai/pipeline.test.js` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ai/rewriter.js` — exported `rewriteDraft(lyrics, critique)` skeleton (returns null)
- [ ] `src/ai/pipeline.js` — exported `runPipeline(input)` skeleton (calls `generateLyrics`, returns `{lyrics, tags, title}`)
- [ ] `src/ai/pipeline.test.js` — 6 test cases in RED state (requires `OPENROUTER_API_KEY`)
- [ ] `package.json` — `test` script updated to include `pipeline.test.js`; `test:pipeline` script added
- [ ] `package.json` — `check` script updated to include `rewriter.js` and `pipeline.js`
- [ ] `src/config.js` — `config.ai.rewriterModel` added (`AI_REWRITER_MODEL` env override)

---

## Test Cases (SC Coverage)

| SC | Description | Test Strategy |
|----|-------------|---------------|
| SC1 | `runPipeline()` returns valid `{lyrics, tags, title}` for all paths | 3 separate test calls (fast path, skip gate, full rewrite) — all must return non-empty string in all 3 fields |
| SC2 | Draft ≥ 12/15 returns without rewriting (fast path confirmed by log) | Use `SPECIFIC_DRAFT` fixture (known high scorer); assert returned lyrics === original draft |
| SC3 | Draft < 12/15 is rewritten with ≥ 20% new tokens | Use `GENERIC_DRAFT` fixture; call `computeNewTokenRatio(original, returned)` and assert ≥ 0.20 |
| SC4 | KEEP sections reproduced verbatim in rewrite | After pipeline run, extract `critique.keep_sections`, verify each section string-equals the corresponding section in returned lyrics |
| SC5 | E2E latency ≤ 150s; timeout returns best draft | Inject mock `rewriteDraft` that never resolves; verify `runPipeline()` exits within 65s (critique 30s + rewrite 60s = 90s, allow margin) and returns `{lyrics, tags, title}` |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rewriter uses thinking mode (warm, not fast) | MODELS-01 | `message.reasoning` field not exposed by test runner | Check server logs for `[rewriter]` entries; a thinking-enabled call takes 10–30s (vs < 5s for non-thinking); confirm timing |
| Bot delivers rewritten song end-to-end | PIPELINE-01 | Requires real Telegram session | Use dev bot token, send a test order, observe `/ping` → generation → delivery; check logs for `[pipeline] rewrite accepted` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
