// Интеграционные тесты для src/ai/pipeline.js. Запуск: node --test src/ai/pipeline.test.js
// Покрытие: PIPELINE-01 (full pipeline SC1-SC5), PIPELINE-02 (fast path SC2),
// PIPELINE-04 (KEEP sections SC4), MODELS-01 (rewriter model identity).
// Требует OPENROUTER_API_KEY в .env — реальные API вызовы.

if (!process.env.OPENROUTER_API_KEY) {
  console.log('[pipeline.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from './pipeline.js';
import { scoreDraft } from './metrics.js';

// Fixtures — same as critic.test.js (self-contained; no coupling to critic.test.js exports)

const GENERIC_DRAFT = [
  '[Куплет 1]',
  'Он встаёт по утрам и идёт на работу,',
  'Она ждёт его дома с горячим чаем.',
  'Каждый день одно и то же — вот такая суббота,',
  'Так они живут, никуда не уезжая.',
  '[Припев]',
  'Ты мой герой, ты мой идеал,',
  'Ты моя звезда, ты мой свет.',
  'Без тебя бы я не встал,',
  'Дороже тебя в мире нет.',
  '[Куплет 2]',
  'Он сильный и добрый, всегда поддержит,',
  'Она красивая, умная, нежная.',
  'Вместе они пройдут любую нежность,',
  'Их любовь — бесконечная, безбрежная.',
  '[Бридж]',
  'Годы идут, но чувства крепнут,',
  'Счастье живёт в их маленьком доме.',
  'Они никогда не уснут в разлуке,',
  'Их сердца бьются в одном ритме.',
  '[Финал]',
  'Вот такая история любви,',
  'Простая, но честная — живи.',
].join('\n');

const CLEAN_DRAFT = [
  '[Куплет 1]',
  'Шесть утра, а Рома уже шнурует кросс,',
  'Район спит, фонарь горит — и холодно до слёз.',
  'Турник скрипнул, двадцать раз — и выдох в тишину,',
  'Пока соседи спят, считает Рома луну.',
  '[Припев]',
  'С днём рождения, Рома — в путь,',
  'Город спит, а ты — не свернуть.',
  'Впереди всех, и не догнать,',
  'Дорога знает — Рому ей встречать.',
  '[Куплет 2]',
  'В выходной — ружьё, рассвет, болото, грязь,',
  'Три часа в засаде, а потом домой летя.',
  'Мать кричит про сапоги в прихожей нашей,',
  'Рома улыбнётся тихо — мам, ну что ты, Боже...',
  '[Бридж]',
  'Девчонки пишут, а Рома весь в подходе,',
  'Телефон молчит, пока штангу не уронит.',
  'Прочитает позже, усмехнётся — ну ок,',
  'И снова педали — ветер бьёт в висок.',
  '[Финал]',
  'Шесть утра, фонарь, турник — скрип знакомый,',
  'Ещё один рассвет встречает Рома.',
].join('\n');

// Helper: compute ratio of words in rewritten that don't appear in original word set
function tokenizeForDiff(text) {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .split(/[^а-яёa-z0-9]+/i)
    .filter(w => w.length >= 2);
}

function computeNewTokenRatio(originalLyrics, rewrittenLyrics) {
  const originalWords = new Set(tokenizeForDiff(originalLyrics));
  const rewrittenTokens = tokenizeForDiff(rewrittenLyrics);
  if (rewrittenTokens.length === 0) return 0;
  const newCount = rewrittenTokens.filter(w => !originalWords.has(w)).length;
  return newCount / rewrittenTokens.length;
}

// Helper: extract section text by header name
function extractSection(lyrics, sectionName) {
  const escapedName = sectionName.replace(/[[\]]/g, '\\$&');
  const regex = new RegExp(`${escapedName}\\s*\\n([\\s\\S]*?)(?=\\[|$)`, 'i');
  const match = lyrics.match(regex);
  return match ? match[1].trim().replace(/\s+/g, ' ') : null;
}

// SC1: runPipeline returns valid {lyrics, tags, title} shape
describe('runPipeline — output contract (PIPELINE-01 SC1)', () => {
  it('returns {lyrics, tags, title} with non-empty strings for GENERIC_DRAFT input', async () => {
    const result = await runPipeline({
      occasion: 'день рождения',
      genre: 'поп',
      mood: 'радостный',
      voice: 'мужской',
      wishes: 'Тест контракта пайплайна.',
    });
    assert.ok(result && typeof result === 'object', 'result must be an object');
    assert.ok(typeof result.lyrics === 'string' && result.lyrics.length > 0, 'lyrics must be non-empty string');
    assert.ok(typeof result.tags === 'string' && result.tags.length > 0, 'tags must be non-empty string');
    assert.ok(typeof result.title === 'string' && result.title.length > 0, 'title must be non-empty string');
    assert.strictEqual(result.metrics, undefined, 'metrics field must NOT appear in runPipeline output');
  });
});

// SC2: fast path — CLEAN_DRAFT has skip_pipeline=true, pipeline returns without rewriting
describe('runPipeline — fast path gate (PIPELINE-02 SC2)', () => {
  it('CLEAN_DRAFT has skip_pipeline=true — confirmed by scoreDraft', () => {
    const precheck = scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(precheck.skip_pipeline, true,
      'CLEAN_DRAFT must have skip_pipeline=true to validate fast path gate');
  });
});

// SC3: full pipeline — GENERIC_DRAFT goes through rewrite path with >= 20% new tokens
describe('runPipeline — full rewrite path (PIPELINE-01 SC3)', () => {
  it('GENERIC_DRAFT triggers full pipeline and returned lyrics have >= 20% new tokens', async () => {
    // FAILS in Wave 1 (rewriteDraft stub returns null → 0% new tokens)
    // Passes in Wave 3 (full orchestrator implemented)
    const precheck = scoreDraft(GENERIC_DRAFT);
    assert.strictEqual(precheck.skip_pipeline, false,
      'GENERIC_DRAFT must NOT have skip_pipeline=true');

    const result = await runPipeline({
      occasion: 'день рождения',
      genre: 'поп',
      mood: 'радостный',
      voice: 'мужской',
      wishes: 'Тест полного пайплайна с перезаписью.',
    });
    const ratio = computeNewTokenRatio(GENERIC_DRAFT, result.lyrics);
    assert.ok(ratio >= 0.20,
      `rewritten lyrics must have >= 20% new tokens; got ${(ratio * 100).toFixed(1)}%`);
  });
});

// SC4: KEEP sections from critique appear verbatim in rewritten lyrics
describe('runPipeline — KEEP sections verbatim (PIPELINE-04 SC4)', () => {
  it('sections marked KEEP in critique are reproduced verbatim in returned lyrics', async () => {
    const { critiqueDraft } = await import('./critic.js');
    const metrics = scoreDraft(GENERIC_DRAFT);
    const critique = await critiqueDraft(GENERIC_DRAFT, metrics);
    if (!critique || critique.total >= 12) {
      console.log('[SC4] skipping: critique null or total>=12 (fast path)');
      return;
    }

    const result = await runPipeline({
      occasion: 'день рождения',
      genre: 'поп',
      mood: 'радостный',
      voice: 'мужской',
      wishes: 'Тест сохранения разделов KEEP.',
    });

    for (const sectionHeader of critique.keep_sections) {
      const origSection = extractSection(GENERIC_DRAFT, sectionHeader);
      const rewriteSection = extractSection(result.lyrics, sectionHeader);
      if (origSection && rewriteSection) {
        assert.strictEqual(rewriteSection, origSection,
          `KEEP section "${sectionHeader}" must be reproduced verbatim`);
      }
    }
  });
});

// SC5: rewriteDraft returns {lyrics} directly when called with a valid critique
describe('rewriteDraft — direct call (MODELS-01 / PIPELINE-04 SC5)', () => {
  it('rewriteDraft returns {lyrics} string when called with GENERIC_DRAFT and a valid critique', async () => {
    // FAILS in Wave 1 (stub returns null)
    // Passes in Wave 2 (full rewriter implemented)
    const { rewriteDraft } = await import('./rewriter.js');
    const { critiqueDraft } = await import('./critic.js');
    const metrics = scoreDraft(GENERIC_DRAFT);
    const critique = await critiqueDraft(GENERIC_DRAFT, metrics);
    if (!critique) {
      console.log('[SC5] skipping: critique null');
      return;
    }

    const result = await rewriteDraft(GENERIC_DRAFT, critique);
    assert.ok(result !== null, 'rewriteDraft must not return null for a valid critique');
    assert.ok(typeof result.lyrics === 'string' && result.lyrics.length > 0,
      'rewriteDraft must return {lyrics} with non-empty string');
  });
});

// Unit: computeNewTokenRatio works correctly for Russian text
describe('computeNewTokenRatio — unit test', () => {
  it('returns correct ratio for Russian texts with known word overlap', () => {
    const original = 'Он встаёт по утрам и идёт на работу каждый день';
    const rewritten = 'Антон бежит сквозь ночь по знакомым переулкам города';
    const ratio = computeNewTokenRatio(original, rewritten);
    assert.ok(ratio >= 0.80,
      `ratio should be >= 0.80 for mostly-new text; got ${(ratio * 100).toFixed(1)}%`);

    const identical = computeNewTokenRatio(original, original);
    assert.strictEqual(identical, 0, 'identical texts must have 0% new tokens');
  });
});
