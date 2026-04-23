// Full G→C→R pipeline orchestrator.
// Wraps generateLyrics() → critiqueDraft() → rewriteDraft() with gate logic and timeouts.
// Returns {lyrics, tags, title} in ALL code paths (same contract as generateLyrics).
// Zero new dependencies.

import { generateLyrics } from './client.js';
import { critiqueDraft } from './critic.js';
import { rewriteDraft } from './rewriter.js';
import { understandSubject } from './analyzer.js';

const ANALYZER_TIMEOUT_MS = 30_000;   // 30s — single Sonnet call, no thinking, structured JSON
const CRITIQUE_TIMEOUT_MS = 60_000;   // 60s — two API calls (specificity + critique) + up to 2 retries; raised from 30s after Герыч v1 (20 апр 11:50): critic finished at 11:52:09 (94s) with valid total=9 critique, but pipeline already timed out at 11:51:05 and shipped original draft
const REWRITE_TIMEOUT_MS = 150_000;   // 150s — raised from 90s after live Герыч (23.04): 33 fake rhymes + lost facts + soul-gate pushed rewriter to 99s, pipeline sdавался и возвращал original. Thinking OFF since 1015847 — обычный прогон быстрее, но edge-case (30+ fake, много rewrite_instructions) всё ещё может упереться в потолок.
const SKIP_GATE_SCORE = 13;           // >= 13/15: fast path, skip rewrite (raised from 12 — Зевс v5 had total=12 with rq=1, fast-pathed despite critic flagging «привет/ответ»)
// Soul floor: rhyme/singability are objective and can carry total to >=12 even when story
// or emotion are 0/1 (e.g. [3,3,3,3,0]). These two dims are non-negotiable — if either
// drops below DIM_FLOOR, force rewrite regardless of total.
const DEAL_BREAKER_DIMS = ['story_specificity', 'emotional_honesty'];
const DIM_FLOOR = 2;

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
 * Word-boundary check for a Russian/mixed-script word inside arbitrary text.
 * Replaces naive `text.includes(word)` which gave false positives like
 * `'нос'` matching `'носит'` or `'кот'` matching `'который'`.
 * Boundary = start/end of string OR any char that is NOT a Russian/Latin letter.
 * Re-implemented (not imported) in critic.js and rewriter.js — keep these in sync.
 * @param {string} text
 * @param {string} word — bare noun, no spaces, case-insensitive
 * @returns {boolean}
 */
export function hasWordMatch(text, word) {
  if (!text || !word) return false;
  const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^а-яёА-ЯЁa-zA-Z])${escaped}(?:[^а-яёА-ЯЁa-zA-Z]|$)`, 'i');
  return re.test(text);
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
 * Gate 3: critique.total >= 13 AND        → return original draft (fast path)
 *         every DEAL_BREAKER_DIM >= 2        soul floor: forces rewrite if story or emotion fail
 *         (raised from 12 — borderline 12 was letting through drafts the critic itself flagged)
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

  // Grounding visibility: did the generator actually use a subject_category_noun?
  logGroundingCheck(draft.lyrics, portrait, 'draft');

  // Gate 1: Phase 1 metrics skip gate — only when there are NO lost facts AND no fake rhymes.
  // lost_facts = proper nouns from user wishes (Казань, Yamaha, имена) that didn't
  // survive into lyrics. If any are missing, force critic + rewriter to recover them.
  // fake rhymes = детектированные сайдкаром пары где ударные гласные различаются или
  // нет общего хвоста. Всегда форсируем rewrite, даже если остальные метрики чистые.
  const lostFacts = draft.metrics?.lost_facts ?? [];
  const fakeRhymes = draft.metrics?.rhymes?.fake ?? [];
  if (draft.metrics?.skip_pipeline && lostFacts.length === 0 && fakeRhymes.length === 0) {
    console.log('[pipeline] metrics gate: skip_pipeline=true + no lost facts + no fake rhymes — fast path');
    return { lyrics: draft.lyrics, tags: draft.tags, title: draft.title };
  }
  if (draft.metrics?.skip_pipeline && lostFacts.length > 0) {
    console.log(`[pipeline] metrics ok BUT lost facts: ${lostFacts.map(f => `«${f}»`).join(', ')} — forcing critic`);
  }
  if (fakeRhymes.length > 0) {
    console.log(`[pipeline] fake rhymes: ${fakeRhymes.map(p => `«${p[0]}/${p[1]}»`).join(', ')} — forcing critic+rewriter`);
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

  // Gate 3: fast path — critique total above threshold AND soul floor not violated.
  // Soul floor: story_specificity and emotional_honesty must each be >= DIM_FLOOR (2).
  // Without this, [3,3,3,3,0] (story=0) gives total=12 and skips rewrite — listener gets
  // a technically clean lyric with no recognisable subject. Force rewrite in that case.
  const failedSoul = DEAL_BREAKER_DIMS.filter(
    dim => (critique[dim]?.score ?? 3) < DIM_FLOOR
  );
  if (failedSoul.length > 0) {
    console.log(`[pipeline] soul gate: ${failedSoul.join(', ')} below floor (${DIM_FLOOR}) — forcing rewrite`);
  } else if (critique.total >= SKIP_GATE_SCORE) {
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
  // Grounding post-check — visibility only. If we still ship lyrics without any
  // subject_category_noun, we want that screaming in the logs so we can catch it.
  logGroundingCheck(rewritten.lyrics, portrait, 'rewritten');
  return { lyrics: rewritten.lyrics, tags: draft.tags, title: draft.title };
}

/**
 * Post-flight check: did the final lyrics actually include any subject_category_noun?
 * Pure logging — does not alter behaviour. If portrait is null or has no nouns, no-op.
 * @param {string} lyrics
 * @param {object|null} portrait
 * @param {string} stage — label for the log line
 */
function logGroundingCheck(lyrics, portrait, stage) {
  const nouns = Array.isArray(portrait?.subject_category_nouns)
    ? portrait.subject_category_nouns.filter(n => typeof n === 'string' && n.trim().length)
    : [];
  if (!nouns.length) return;
  const present = nouns.filter(n => hasWordMatch(lyrics, n));
  if (present.length) {
    console.log(`[pipeline] grounding ok (${stage}): present ${present.map(n => `«${n}»`).join(', ')}`);
  } else {
    console.log(`[pipeline] ⚠ grounding MISS (${stage}): none of ${nouns.map(n => `«${n}»`).join(', ')} appear in lyrics`);
  }
}
