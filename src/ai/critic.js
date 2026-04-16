// Two-call LLM critic: specificity judge (METRICS-03) + 5-dimension critique (PIPELINE-03).
// Uses anthropic/claude-sonnet-4.6 via OpenRouter. No new dependencies.
// Wave 1 skeleton — stubs return fixed defaults so tests run and fail (RED state).
// Wave 2 replaces stub bodies with real OpenRouter calls.

import { config } from '../config.js';

// [VERIFIED: openrouter.ai/anthropic/claude-sonnet-4.6 — dot notation, released 2026-02-17]
// Note: dot notation is OpenRouter namespace; Anthropic API uses hyphens (claude-sonnet-4-6).
// Hardcoded with optional env override via config.ai.criticModel.
const CRITIC_MODEL = config.ai.criticModel || 'anthropic/claude-sonnet-4.6';

/**
 * METRICS-03 — separate micro-call: does the draft contain proper nouns and time expressions?
 * @param {string} lyrics
 * @returns {Promise<{has_proper_nouns: boolean, has_time_expressions: boolean}>}
 */
export async function judgeSpecificity(lyrics) {
  // Wave 1 stub — returns fixed defaults; Wave 2 replaces with OpenRouter micro-call.
  // Must be async so the export shape matches Wave 2 implementation.
  void lyrics; // mark parameter as intentionally unused in stub
  void CRITIC_MODEL; // referenced so import is not dead code
  return { has_proper_nouns: false, has_time_expressions: false };
}

/**
 * PIPELINE-03 — 5-dimension critique. Caller passes Phase 1 metrics from scoreDraft().
 * Wave 1 stub returns null (caller treats as "skip pipeline"); Wave 2 returns critique JSON.
 * @param {string} lyrics
 * @param {object} metrics - output of scoreDraft() from src/ai/metrics.js
 * @returns {Promise<null | object>}
 */
export async function critiqueDraft(lyrics, metrics) {
  // Wave 1 stub — returns null. Wave 2 implements the full 2-attempt OpenRouter call.
  void lyrics;
  void metrics;
  return null;
}
