---
phase: 1
slug: programmatic-metrics-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node.js 22 built-in) |
| **Config file** | none — native test runner |
| **Quick run command** | `node --test src/ai/metrics.test.js` |
| **Full suite command** | `node --test src/ai/metrics.test.js` |
| **Estimated runtime** | ~2 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test src/ai/metrics.test.js`
- **After every plan wave:** Run `node --test src/ai/metrics.test.js`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-banale | 01 | 1 | METRICS-01 | — | N/A | unit | `node --test src/ai/metrics.test.js` | ❌ W0 | ⬜ pending |
| 1-syllable | 01 | 1 | METRICS-02 | — | N/A | unit | `node --test src/ai/metrics.test.js` | ❌ W0 | ⬜ pending |
| 1-mattr | 01 | 1 | METRICS-04 | — | N/A | unit | `node --test src/ai/metrics.test.js` | ❌ W0 | ⬜ pending |
| 1-gate | 01 | 2 | METRICS-01,02,04 | — | N/A | unit | `node --test src/ai/metrics.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ai/metrics.test.js` — test stubs for METRICS-01, METRICS-02, METRICS-04

*Test stubs must exist before implementation tasks run.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gate output matches live song draft | METRICS-01,02,04 | Requires real AI-generated text | Run scoreDraft() on a real generateLyrics() output, inspect result |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
