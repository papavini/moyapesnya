---
phase: 2
slug: critic-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 22 built-in) |
| **Config file** | none — run directly with `node --test` |
| **Quick run command** | `node --test src/ai/critic.test.js` |
| **Full suite command** | `node --test src/ai/metrics.test.js src/ai/critic.test.js` |
| **Estimated runtime** | ~10-20 seconds (integration tests — real OpenRouter API calls) |

**Important:** Phase 2 tests call the real OpenRouter API. They require `OPENROUTER_API_KEY` in environment. Guard at top of `critic.test.js`:
```js
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[critic.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}
```

---

## Sampling Rate

- **After every task commit:** Run `npm run check && node --test src/ai/critic.test.js`
- **After every plan wave:** Run `node --test src/ai/metrics.test.js src/ai/critic.test.js`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (integration tests include API round-trip)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PIPELINE-03 | — | N/A | unit (smoke) | `node --check src/ai/critic.js && node -e "import('./src/ai/critic.js').then(m=>console.log(typeof m.critiqueDraft, typeof m.judgeSpecificity))"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PIPELINE-03 | — | N/A | integration (RED) | `node --test src/ai/critic.test.js; [ $? -ne 0 ] && echo "RED OK"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | MODELS-02 | — | N/A | unit | `node --check src/config.js && node -e "import('./src/config.js').then(m=>{ if(!m.config.ai.criticModel) throw new Error('missing criticModel'); console.log('OK') })"` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | METRICS-03 | — | N/A | integration | `node --test src/ai/critic.test.js` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | PIPELINE-03 | — | N/A | integration | `node --test src/ai/critic.test.js` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | PIPELINE-03 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ai/critic.js` — module skeleton with exported `judgeSpecificity` and `critiqueDraft` (callable stubs)
- [ ] `src/ai/critic.test.js` — 6 test cases (RED state initially, integration tests with API guard)
- [ ] `src/config.js` — add `config.ai.criticModel` field (optional env override for `AI_CRITIC_MODEL`)
- [ ] `package.json` — update `test` script to include both test files; add `test:critic` script

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Critique text quality | PIPELINE-03 | Subjective: does the `rewrite_instructions` text actually guide a rewriter? | Run `critiqueDraft(GENERIC_DRAFT, metrics)` and read the instructions — should cite specific lines, not generic advice |
| Scoring consistency | MODELS-02 | Statistical: run same draft 3x, check score variance is ≤ 1 per dimension | Call `critiqueDraft(SPECIFIC_DRAFT, metrics)` 3 times, compare scores |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
