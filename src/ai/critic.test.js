// Интеграционные тесты для src/ai/critic.js. Запуск: node --test src/ai/critic.test.js
// Покрытие: PIPELINE-03 (5-dimension critique), METRICS-03 (specificity judge),
// MODELS-02 (critic model identity).
// Требует OPENROUTER_API_KEY в .env — реальные API вызовы.

// API key guard MUST appear before the imports that touch the critic module so we do not
// even attempt the integration tests in a CI/dev environment without credentials.
if (!process.env.OPENROUTER_API_KEY) {
  console.log('[critic.test] OPENROUTER_API_KEY not set — skipping');
  process.exit(0);
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { judgeSpecificity, critiqueDraft } from './critic.js';
import { scoreDraft } from './metrics.js';

// Fixture 1 (RESEARCH.md Pattern 5): zero proper nouns, zero time expressions.
// Expected: judgeSpecificity → {has_proper_nouns: false, has_time_expressions: false}
// Expected: critiqueDraft.story_specificity.score <= 1
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

// Fixture 2 (RESEARCH.md Pattern 5): proper nouns (Рома, Митино) + time (Шесть утра).
// Expected: judgeSpecificity → {has_proper_nouns: true, has_time_expressions: true}
// Expected: critiqueDraft.story_specificity.score >= 2
const SPECIFIC_DRAFT = [
  '[Куплет 1]',
  'Шесть утра, а Рома уже шнурует кросс,',
  'Район Митино спит, фонарь горит — и холодно до слёз.',
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
  'Мать кричит: «Опять сапожищи в прихожей!»',
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

// Fixture 3: a clean draft that passes the Phase 1 gate (skip_pipeline === true).
// Identical to CLEAN_DRAFT in src/ai/metrics.test.js — kept inline so this test file is
// self-contained and does not couple to metrics.test.js exports.
// Expected: scoreDraft(CLEAN_DRAFT).skip_pipeline === true
// Expected: critiqueDraft(CLEAN_DRAFT, scoreDraft(CLEAN_DRAFT)).total >= 12
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

const DIMS = [
  'story_specificity',
  'chorus_identity',
  'rhyme_quality',
  'singability',
  'emotional_honesty',
];

describe('judgeSpecificity (METRICS-03)', () => {
  it('returns false/false for generic draft with no proper nouns or time expressions', async () => {
    const result = await judgeSpecificity(GENERIC_DRAFT);
    assert.strictEqual(result.has_proper_nouns, false,
      'GENERIC_DRAFT contains no personal names or place names');
    assert.strictEqual(result.has_time_expressions, false,
      'GENERIC_DRAFT contains no specific time expressions');
  });

  it('returns true/true for specific draft with Рома, Митино, Шесть утра', async () => {
    const result = await judgeSpecificity(SPECIFIC_DRAFT);
    assert.strictEqual(result.has_proper_nouns, true,
      'SPECIFIC_DRAFT contains "Рома" and "Митино" as proper nouns');
    assert.strictEqual(result.has_time_expressions, true,
      'SPECIFIC_DRAFT contains "Шесть утра" as a time expression');
  });
});

describe('critiqueDraft (PIPELINE-03)', () => {
  it('returns valid JSON with all 5 dimensions present, each score in 0-3, plus total', async () => {
    const metrics = await scoreDraft(GENERIC_DRAFT);
    const critique = await critiqueDraft(GENERIC_DRAFT, metrics);
    assert.ok(critique !== null, 'critiqueDraft must not return null on a well-formed draft');
    for (const dim of DIMS) {
      assert.ok(typeof critique[dim]?.score === 'number',
        `${dim}.score must be a number, got ${JSON.stringify(critique[dim])}`);
      assert.ok(critique[dim].score >= 0 && critique[dim].score <= 3,
        `${dim}.score must be 0-3, got ${critique[dim].score}`);
    }
    assert.ok(typeof critique.total === 'number',
      'total must be a number');
    assert.ok(critique.total >= 0 && critique.total <= 15,
      `total must be 0-15, got ${critique.total}`);
    // Re-computed total guard (RESEARCH.md Pitfall 2)
    const expectedTotal = DIMS.reduce((s, d) => s + critique[d].score, 0);
    assert.strictEqual(critique.total, expectedTotal,
      `total must equal sum of dimension scores: expected ${expectedTotal}, got ${critique.total}`);
  });

  it('failing dimension (score <= 1) has non-empty rewrite_instructions', async () => {
    const metrics = await scoreDraft(GENERIC_DRAFT);
    const critique = await critiqueDraft(GENERIC_DRAFT, metrics);
    assert.ok(critique !== null, 'critique must not be null');
    const failing = DIMS.filter(d => critique[d].score <= 1);
    assert.ok(failing.length >= 1,
      `GENERIC_DRAFT should fail at least one dimension; got scores ${DIMS.map(d => `${d}=${critique[d].score}`).join(', ')}`);
    for (const dim of failing) {
      assert.ok(typeof critique[dim].rewrite_instructions === 'string'
        && critique[dim].rewrite_instructions.trim().length > 0,
        `${dim} has score ${critique[dim].score} but rewrite_instructions is empty`);
    }
  });

  it('keep_sections has at least 2 entries', async () => {
    const metrics = await scoreDraft(SPECIFIC_DRAFT);
    const critique = await critiqueDraft(SPECIFIC_DRAFT, metrics);
    assert.ok(critique !== null, 'critique must not be null');
    assert.ok(Array.isArray(critique.keep_sections),
      'keep_sections must be an array');
    assert.ok(critique.keep_sections.length >= 2,
      `keep_sections must have >= 2 entries, got ${JSON.stringify(critique.keep_sections)}`);
  });

  it('Phase 1 passing draft (skip_pipeline=true) produces critique total >= 12', async () => {
    const metrics = await scoreDraft(CLEAN_DRAFT);
    // Precondition: this fixture really does pass the Phase 1 gate.
    assert.strictEqual(metrics.skip_pipeline, true,
      `precondition: CLEAN_DRAFT must pass Phase 1 gate; metrics=${JSON.stringify(metrics)}`);
    const critique = await critiqueDraft(CLEAN_DRAFT, metrics);
    assert.ok(critique !== null, 'critique must not be null on a clean draft');
    assert.ok(critique.total >= 12,
      `Phase 1-passing draft must score total >= 12, got ${critique.total}`);
  });
});
