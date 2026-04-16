# Coding Conventions

**Analysis Date:** 2026-04-16

## Language & Module System

- **ES Modules (ESM)** throughout — `"type": "module"` in `package.json`
- All files use `import`/`export`, never `require()`
- Dynamic imports used for lazy-loading heavy modules:
  ```js
  const { refreshCookie } = await import('./refresh-cookie.js');
  ```
- All import paths include `.js` extension explicitly (ESM requirement)

## Naming Patterns

**Files:**
- `camelCase.js` for all source files: `client.js`, `generate.js`, `robokassa.js`
- Grouped by domain in subdirectories: `src/suno/`, `src/bots/`, `src/ai/`, `src/flow/`, `src/payment/`, `src/server/`

**Functions:**
- `camelCase` for all functions: `generateCustom`, `waitForClips`, `handleSunoError`, `createTelegramBot`
- `createX` prefix for factory functions that return an object: `createTelegramBot()`, `createVkBot()`
- `handleX` prefix for event handlers: `handleMessage`, `handleGenerate`, `handleSunoError`
- Boolean functions use verb prefix: `isGenerating()`, `isUserVerified()`, `pingSuno()`
- Async functions that refresh/update use verb: `refreshCookie()`, `refreshPasskeyToken()`, `ensureTokenAlive()`

**Variables:**
- `camelCase` for all variables and constants
- SCREAMING_SNAKE_CASE only for module-level constants that are truly fixed:
  `CDP_HOST`, `CDP_PORT`, `COOKIE_FILE`, `PLATFORM`, `WELCOME`, `WISHES_PROMPT`
- Boolean env parsing uses helper: `bool(process.env.X, fallback)`
- Numeric env parsing uses helper: `num(process.env.X, fallback)` — see `src/config.js`

**Classes:**
- PascalCase: `SunoError` extends `Error` (only one class in the codebase)

## Code Style

**Formatting:**
- No ESLint or Prettier config files — formatting is manual/editor-driven
- Semicolons: always present at statement ends
- Quotes: single quotes for strings throughout
- Trailing commas: present in multi-line objects/arrays
- Spacing: 2-space indentation universally
- Arrow functions for callbacks: `(r) => setTimeout(r, ...)`, `(e) => console.error(...)`

**Linting:**
- No ESLint configured
- Syntax check only via `npm run check` script (uses `node --check` flag on each source file)
- No type checking (plain JavaScript, no TypeScript or JSDoc types on most functions)

## Import Organization

**Order (observed pattern):**
1. External packages: `import { Bot } from 'grammy'`, `import { fetch } from 'undici'`
2. Internal config: `import { config } from '../config.js'`
3. Internal modules: `import { getSession } from '../store.js'`
4. Node built-ins come last or mixed with externals: `import { createHash } from 'crypto'`

**Path Aliases:**
- None — all imports use relative paths: `'../config.js'`, `'./refresh-cookie.js'`

## Error Handling

**Strategy:** try/catch everywhere, never let errors propagate uncaught to the user.

**Patterns:**

Swallowed non-critical errors (UI operations that can fail silently):
```js
try { await ctx.deleteMessage(); } catch {}
try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
```

Logged errors with context prefix tag:
```js
console.error('[telegram] AI ошибка:', e.message, e.stack?.substring(0, 200));
console.error('[suno] waitForClips poll error:', e.message, '— retrying...');
```

Custom error class for HTTP errors with status/body:
```js
// src/suno/client.js
class SunoError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SunoError';
    this.status = status;
    this.body = body;
  }
}
```

Retry loops with attempt counter (used in `src/ai/client.js` and `src/suno/client.js`):
```js
for (let attempt = 1; attempt <= 3; attempt++) {
  try { ... break; } catch (e) {
    if (attempt === 3) throw e;
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

Cascade retry for SUNO (nested try/catch for 2 fix cycles):
```js
// src/suno/client.js — generateCustom
try {
  return await post(...);
} catch (e) {
  if (!await handleSunoError(e, fills)) throw e;
  try {
    return await post(...);
  } catch (e2) {
    if (!await handleSunoError(e2, fills)) throw e2;
    return await post(...); // final attempt
  }
}
```

## Logging

**Framework:** `console.log` / `console.error` — no logging library.

**Pattern:** Every log line prefixed with `[module]` tag in square brackets:
```js
console.log('[suno] cookie expired, refreshing via CDP...');
console.log('[telegram] @username запущен (long-polling)');
console.error('[webhook] signature INVALID');
console.log('[ai] attempt 2: HTTP 429');
```

**What to log:**
- Service startup and shutdown events
- External API call failures with attempt number
- State transitions in generation flow
- Cookie/token refresh lifecycle
- User actions at key decision points (confirm, generate)

**What NOT to log:**
- Cookie values, tokens, or user content (PII)
- Every Telegram message received (only key state changes)

## Comments

**Module-level JSDoc blocks** on all exported functions:
```js
/**
 * Ждём пока хотя бы один клип станет complete (или все failed).
 * onProgress(clips) вызывается на каждом тике.
 */
export async function waitForClips(ids, { onProgress } = {}) {
```

**Inline comments** explain non-obvious decisions, especially around external service quirks:
```js
// Только complete — это финальный трек на cdn1.suno.ai/.mp3 (2-3 минуты).
// streaming = превью-огрызок ~30 сек на audiopipe.suno.ai, не считаем готовым.
```

**File-level comments** in complex modules explain the overall algorithm before the code:
```js
// Клиент к self-hosted gcui-art/suno-api.
// Ожидаемые эндпоинты (проверь README suno-api — они меняются от версии):
//   POST /api/generate  ...
```

## Function Design

**Size:** Functions can be long when they represent a complete user flow (e.g., `handleGenerate` in `src/bots/telegram.js` is ~100 lines). Business logic separation is by module, not strict line limits.

**Parameters:** Options objects with destructuring for functions with 3+ params:
```js
export async function runGeneration({ mode, lyrics, tags, title, instrumental, onStatus })
export async function waitForClips(ids, { onProgress } = {})
```

**Callbacks:** Used for progress reporting — `onStatus` / `onProgress` pattern:
```js
opts.onStatus ?? (() => {})  // default no-op
```

**Return values:** Structured result objects with `ok` boolean flag for operations that can fail gracefully:
```js
return { ok: false, error: 'Студия временно недоступна.' };
return { ok: true, clips: toSend, allClips: clips };
```

## Module Design

**Exports:**
- Named exports throughout — no default exports in `src/` files
- `export function`, `export async function`, `export const`
- Single export group per file (no barrel/index files)

**Barrel Files:** None used — all imports go directly to the source file.

**State:** Module-level mutable variables used for lightweight state:
```js
// src/queue.js
const jobs = [];
let running = false;

// src/bots/telegram.js
let welcomeVideoFileId = null;
```

## Russian Language in Code

Comments, log messages, error strings, and user-facing text are in Russian. Variable/function names are English. This is the consistent convention throughout the codebase.

---

*Convention analysis: 2026-04-16*
