// Rewrites a song draft given a structured critique from critic.js.
// Uses google/gemini-2.5-flash with thinking mode ON (reasoning.max_tokens = 8000).
// Returns {lyrics} on success, null on failure or exhausted retries.
// Zero new dependencies.
// Wave 1 skeleton — stub returns null so tests run and fail (RED state).
// Wave 2 replaces stub body with real OpenRouter call + REWRITER_SYSTEM_PROMPT.

import { config } from '../config.js';

const REWRITER_MODEL = config.ai.rewriterModel || 'google/gemini-2.5-flash';

/**
 * Rewrites lyrics based on a critique from critiqueDraft().
 * @param {string} lyrics - original song draft
 * @param {object} critique - output of critiqueDraft() from src/ai/critic.js
 * @returns {Promise<{lyrics: string} | null>}
 */
export async function rewriteDraft(lyrics, critique) {
  // Wave 1 stub — returns null. Wave 2 implements the full 2-attempt OpenRouter call.
  void lyrics;
  void critique;
  void REWRITER_MODEL;
  return null;
}
