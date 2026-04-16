// Full G→C→R pipeline orchestrator.
// Wraps generateLyrics() → critiqueDraft() → rewriteDraft() with gate logic and timeouts.
// Returns {lyrics, tags, title} in ALL code paths (same contract as generateLyrics).
// Zero new dependencies.

import { generateLyrics } from './client.js';
import { critiqueDraft } from './critic.js';
import { rewriteDraft } from './rewriter.js';
import { understandSubject } from './analyzer.js';

const ANALYZER_TIMEOUT_MS = 30_000;   // 30s — single Sonnet call, no thinking, structured JSON
const CRITIQUE_TIMEOUT_MS = 30_000;   // 30s — two API calls (specificity + critique)
const REWRITE_TIMEOUT_MS = 90_000;    // 90s — Claude Sonnet 4.6 with extended thinking is slower than Gemini Flash
const SKIP_GATE_SCORE = 12;           // >= 12/15: fast path, skip rewrite

/**
 * Wraps a promise with a timeout. Rejects with an Error on timeout.
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} label - used in the rejection message for logging
 * @returns {Promise}
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`[pipeline] timeout: ${label} exceeded ${ms}ms`)),
        ms
      )
    ),
  ]);
}

/**
 * Tokenizes Russian/mixed text for word-level diff. Removes section headers, splits on
 * non-word chars, filters short tokens. Matches tokenize() pattern from metrics.js.
 * @param {string} text
 * @returns {string[]}
 */
function tokenizeForDiff(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')          // remove [Куплет 1], [Припев], etc.
    .split(/[^а-яёa-z0-9]+/i)            // split on non-word chars
    .filter(w => w.length >= 2);         // same filter as metrics.js
}

/**
 * Computes the ratio of words in rewrittenLyrics that don't appear in originalLyrics.
 * Used as sycophancy guard: rewrite is accepted only if ratio >= 0.20.
 * @param {string} originalLyrics
 * @param {string} rewrittenLyrics
 * @returns {number} 0.0 – 1.0
 */
function computeNewTokenRatio(originalLyrics, rewrittenLyrics) {
  const originalWords = new Set(tokenizeForDiff(originalLyrics));
  const rewrittenTokens = tokenizeForDiff(rewrittenLyrics);
  if (rewrittenTokens.length === 0) return 0;
  const newCount = rewrittenTokens.filter(w => !originalWords.has(w)).length;
  return newCount / rewrittenTokens.length;
}

/**
 * Full Understand → Generate → Critique → Rewrite pipeline.
 *
 * Step U:  build subject portrait (analyzer); null on failure → degrades gracefully
 * Gate 1: metrics.skip_pipeline === true  → return immediately (no critique, no rewrite)
 * Gate 2: critiqueDraft returns null      → return original draft (critic failure)
 * Gate 3: critique.total >= 12            → return original draft (fast path)
 * Gate 4: rewriteDraft returns null       → return original draft (rewriter failure)
 * Gate 5: < 15% new tokens                → return original draft (sycophancy guard)
 *
 * @param {{occasion: string, genre: string, mood: string, voice: string, wishes: string}} input
 * @returns {Promise<{lyrics: string, tags: string, title: string}>}
 */
export async function runPipeline({ occasion, genre, mood, voice, wishes }) {
  // Step U: understand subject — rich portrait used by all downstream steps.
  // Non-fatal: on failure or timeout we proceed with portrait=null and the existing
  // wishes-only behaviour (graceful degradation — pipeline keeps the same contract).
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

  // Step G: generate draft (portrait is optional — generator falls back to wishes-only when null)
  const draft = await generateLyrics({ occasion, genre, mood, voice, wishes, portrait });
  // draft = {lyrics, tags, title, metrics} — tags and title always come from here

  // Gate 1: Phase 1 metrics skip gate
  if (draft.metrics?.skip_pipeline) {
    console.log('[pipeline] metrics gate: skip_pipeline=true — fast path');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Step C: critique with timeout (portrait gives critic a benchmark for story_specificity)
  let critique = null;
  try {
    critique = await withTimeout(
      critiqueDraft(draft.lyrics, draft.metrics, portrait),
      CRITIQUE_TIMEOUT_MS,
      'critiqueDraft'
    );
  } catch (e) {
    console.log('[pipeline] critique step failed:', e.message, '— using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Gate 2: critique null (critic failure)
  if (!critique) {
    console.log('[pipeline] critique null — critic failed, using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Gate 3: fast path — critique total above threshold
  if (critique.total >= SKIP_GATE_SCORE) {
    console.log(`[pipeline] critique total=${critique.total} — above threshold, fast path`);
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Step R: rewrite with timeout (portrait keeps the rewrite anchored to the same character)
  let rewritten = null;
  try {
    rewritten = await withTimeout(
      rewriteDraft(draft.lyrics, critique, portrait),
      REWRITE_TIMEOUT_MS,
      'rewriteDraft'
    );
  } catch (e) {
    console.log('[pipeline] rewrite step failed:', e.message, '— using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Gate 4: rewriter returned null (failure)
  if (!rewritten) {
    console.log('[pipeline] rewriteDraft returned null — using original draft');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  // Gate 5: sycophancy guard — require >= 15% new tokens.
  // Lowered from 0.20 → 0.15 (2026-04-16): with 2-of-5 KEEP sections, geometric ceiling
  // for total new-token ratio is ~30%, so 20% rejected legit Sonnet 4.6 rewrites at 19.7%.
  const newTokenRatio = computeNewTokenRatio(draft.lyrics, rewritten.lyrics);
  if (newTokenRatio < 0.15) {
    console.log(
      `[pipeline] rewrite rejected (sycophancy: only ${(newTokenRatio * 100).toFixed(1)}% new tokens), using original`
    );
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }

  console.log(`[pipeline] rewrite accepted: ${(newTokenRatio * 100).toFixed(1)}% new tokens`);
  return { lyrics: rewritten.lyrics, tags: draft.tags, title: draft.title };
}
