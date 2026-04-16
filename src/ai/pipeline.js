// Full G→C→R pipeline orchestrator.
// Wraps generateLyrics() → critiqueDraft() → rewriteDraft() with gate logic and timeouts.
// Returns {lyrics, tags, title} in all code paths (same contract as generateLyrics).
// Zero new dependencies.
// Wave 1 skeleton — stub calls generateLyrics and returns {lyrics, tags, title} directly.
// Wave 3 replaces stub with full orchestrator (gates, timeouts, sycophancy guard).

import { generateLyrics } from './client.js';
import { critiqueDraft } from './critic.js';
import { rewriteDraft } from './rewriter.js';

/**
 * Full Generate → Critique → Rewrite pipeline.
 * @param {{occasion: string, genre: string, mood: string, voice: string, wishes: string}} input
 * @returns {Promise<{lyrics: string, tags: string, title: string}>}
 */
export async function runPipeline({ occasion, genre, mood, voice, wishes }) {
  // Wave 1 stub — calls generateLyrics and returns {lyrics, tags, title} directly.
  // Wave 3 replaces with full G→C→R orchestration with gates and timeouts.
  void critiqueDraft;
  void rewriteDraft;
  const draft = await generateLyrics({ occasion, genre, mood, voice, wishes });
  return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
}
