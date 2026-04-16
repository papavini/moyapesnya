# Testing Patterns

**Analysis Date:** 2026-04-16

## Test Framework

**Runner:** None configured. No test framework is installed or referenced.

**Assertion Library:** None.

**Test scripts in `package.json`:**
```bash
npm run check   # Syntax-only: node --check on 7 specific source files
```
The `check` script is the only automated quality gate:
```json
"check": "node --check src/index.js && node --check src/config.js && node --check src/store.js && node --check src/suno/client.js && node --check src/flow/generate.js && node --check src/bots/telegram.js && node --check src/bots/vk.js"
```
This catches parse errors only — it does not execute any code.

## Test Files

**Unit/integration test files:** None found. No `*.test.js`, `*.spec.js`, or `__tests__/` directory exists in the project.

## Manual Test Scripts

The root directory contains numerous ad-hoc `.mjs` debug/test scripts used during development. These are NOT automated tests — they require manual execution against a live server:

- `test_full_flow.mjs` — end-to-end flow test (manual)
- `test_refresh_passkey.mjs` — passkey refresh test (manual)
- `test_refresh.mjs` — cookie refresh test (manual)
- `test_diagnose.mjs` — connection diagnostics (manual)
- `test_advanced_create.mjs`, `test_after_click.mjs`, `test_create_deep.mjs` — CDP automation tests
- `get_passkey.mjs`, `get_token_direct.mjs`, `get_token_v2.mjs` — token capture utilities
- `intercept_generate.mjs`, `scan_p1.mjs` — network interception scripts

These scripts live at the project root, not in a dedicated test directory. They connect to real infrastructure (Chromium CDP at ports 9222/9223, SUNO API at localhost:3000) and are not idempotent.

## Coverage

**Requirements:** None enforced — no coverage tooling configured.

**Current state:** 0% automated test coverage.

## How the Codebase is Validated in Practice

Since there are no automated tests, validation happens through:

1. **Syntax check:** `npm run check` — catches JS parse errors only.

2. **Live integration testing:** Manual execution of `test_*.mjs` scripts against the running server infrastructure.

3. **Observational validation:** Watching `journalctl -u podari-bot -f` logs during real interactions to confirm correct behavior.

4. **Error-triggered recovery testing:** The 2026-04-14 session documented deliberate cookie invalidation to verify the auto-recovery cascade (500 → session error → refreshCookie → retry).

## Testable Units (If Tests Were Added)

The following modules have pure or near-pure logic that could be unit tested without infrastructure:

**`src/config.js`:**
- `num(v, fallback)` — pure number parsing
- `bool(v, fallback)` — pure boolean parsing
- `assertBotConfig(which)` — throws on missing config

**`src/store.js`:**
- All functions are pure in-memory Map operations
- `getSession`, `setState`, `resetSession`, `setPayment`, `getPayment`, `findPaymentByUser`

**`src/queue.js`:**
- `getQueueLength()`, `isGenerating()`, `getNextPosition()` — pure state reads
- `enqueue(fn)` — testable with mock async functions

**`src/access-codes.js`:**
- `checkAndUseCode(code, userId)` — pure Map mutation, returns `'ok'|'invalid'|'used'`
- `isUserVerified(userId)` — pure Map lookup
- `getCodesStatus()` — pure Map read

**`src/payment/robokassa.js`:**
- `createInvoiceUrl(invId, amount, description)` — deterministic URL building
- `verifyResult(params)` — MD5 signature verification
- `generateInvId(userId)` — depends on `Date.now()` + counter (partially pure)

**`src/ai/client.js`:**
- `extractTitle(lyrics, occasion, wishes)` — pure regex-based string extraction

## Mocking Requirements (Hypothetical)

If tests were added, the following would need mocking:

- `fetch` / `undici.fetch` — for `src/suno/client.js` and `src/ai/client.js`
- `ws` (WebSocket) — for `src/suno/refresh-cookie.js` and `src/suno/refresh-passkey.js`
- `child_process.execSync` — for `systemctl restart` in `src/suno/refresh-cookie.js`
- `fs.writeFileSync` / `fs.readFileSync` — for cookie file writes and video file ID cache
- `process.env` — for config testing

Node's built-in `node:test` runner (available in Node 22) would be the natural choice given the no-dependency philosophy of this project.

## Recommended First Test Targets

In priority order based on correctness criticality:

1. `src/store.js` — zero dependencies, covers session/payment state machine
2. `src/access-codes.js` — zero dependencies, covers beta access gate
3. `src/payment/robokassa.js` — MD5 signature logic is security-relevant
4. `src/queue.js` — serial queue correctness prevents duplicate generations
5. `src/config.js` — `num()` and `bool()` edge cases (NaN, null, empty string)

---

*Testing analysis: 2026-04-16*
