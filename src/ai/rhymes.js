// Node HTTP client for the rhyme-detector Python sidecar.
// Sidecar lives on 127.0.0.1:3100 (systemd unit `rhyme-sidecar.service`, see services/rhyme-sidecar/).
// Purpose: deterministic TRUE/APPROXIMATE/FAKE classification of rhyme pairs in Russian lyrics
// — replaces the subjective LLM `rhyme_quality` judgement that has been letting fake pairs
// (всё/по-своему, глаза/тебя, привет/ответ) reach production.
//
// GRACEFUL DEGRADATION: any failure (timeout, connection refused, non-OK status, bad JSON)
// → return an empty rhyme object. The bot KEEPS generating songs; the critic falls back
// to its own DIMENSION 3 rubric. We never block a paid order because of a sidecar outage.

import { config } from '../config.js';

const EMPTY = Object.freeze({ true: [], approximate: [], fake: [] });

/**
 * Calls the sidecar's POST /detect and returns rhyme buckets. On any failure
 * returns EMPTY and logs a single warning line (no stack trace, no retry).
 *
 * @param {string} lyrics - full draft including section headers [Куплет 1] etc.
 * @returns {Promise<{true: string[][], approximate: string[][], fake: string[][]}>}
 */
export async function detectRhymes(lyrics) {
  const url = config.rhymes?.sidecarUrl || 'http://127.0.0.1:3100/detect';
  const timeoutMs = config.rhymes?.timeoutMs || 3000;

  if (!lyrics || typeof lyrics !== 'string') return { ...EMPTY };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lyrics }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    const rhymes = data?.rhymes || {};
    return {
      true: Array.isArray(rhymes.true) ? rhymes.true : [],
      approximate: Array.isArray(rhymes.approximate) ? rhymes.approximate : [],
      fake: Array.isArray(rhymes.fake) ? rhymes.fake : [],
    };
  } catch (e) {
    const reason = e.name === 'AbortError' ? `timeout ${timeoutMs}ms` : e.message;
    console.warn(`[rhymes] sidecar unavailable (${reason}) — fallback to empty`);
    return { ...EMPTY };
  } finally {
    clearTimeout(timer);
  }
}
