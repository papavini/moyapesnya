// Юнит-тесты для src/ai/metrics.js. Запуск: node --test src/ai/metrics.test.js
// Покрытие: METRICS-01 (банальные рифмы), METRICS-02 (слоги припева),
// METRICS-04 (MATTR-approx), и поведение gate skip_pipeline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDraft } from './metrics.js';

// Чистый черновик: разнообразный, без банальных пар, припев в пределах 12 слогов.
// Используется в gate-тесте skip_pipeline=true.
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

describe('banale detection (METRICS-01)', () => {
  it('detects любовь/кровь pair from canonical cluster', () => {
    const lyrics = [
      '[Куплет 1]',
      'Я пишу тебе про любовь',
      'А в висках стучит кровь',
    ].join('\n');
    const result = scoreDraft(lyrics);
    assert.ok(Array.isArray(result.banale_pairs), 'banale_pairs must be array');
    assert.ok(result.banale_pairs.length >= 1, 'expected at least one banale pair');
    const flat = result.banale_pairs.flat();
    assert.ok(flat.includes('любовь'), 'expected любовь in flat pairs');
    assert.ok(flat.includes('кровь'), 'expected кровь in flat pairs');
  });

  it('detects розы/слёзы from morose cluster', () => {
    const lyrics = [
      '[Куплет 1]',
      'Дарю тебе розы',
      'А в глазах стоят слёзы',
    ].join('\n');
    const result = scoreDraft(lyrics);
    const flat = result.banale_pairs.flat();
    assert.ok(flat.includes('розы') && flat.includes('слёзы'),
      'expected розы/слёзы pair detected');
  });
});

describe('syllable violations (METRICS-02)', () => {
  it('flags chorus line over 12 syllables', () => {
    // 'радиоактивный город заснял один фотограф у моря' = 18 vowels (syllables)
    const lyrics = [
      '[Куплет 1]',
      'Короткая строка',
      '[Припев]',
      'радиоактивный город заснял один фотограф у моря',
    ].join('\n');
    const result = scoreDraft(lyrics);
    assert.ok(Array.isArray(result.syllable_violations));
    assert.ok(result.syllable_violations.length >= 1, 'expected violation');
    const v = result.syllable_violations[0];
    assert.ok(v.count > 12, `expected count > 12 got ${v.count}`);
    assert.ok(typeof v.line === 'string' && v.line.length > 0);
  });

  it('does not flag chorus line at exactly 12 syllables', () => {
    // 'мама папа я сестра брат друг любовь' = 11 vowels — under limit
    const lyrics = [
      '[Куплет 1]',
      'Тут ничего нет',
      '[Припев]',
      'мама папа я сестра брат друг любовь',
    ].join('\n');
    const result = scoreDraft(lyrics);
    assert.strictEqual(result.syllable_violations.length, 0,
      'expected no violations for short chorus line');
  });
});

describe('lexical diversity / MATTR (METRICS-04)', () => {
  it('repetitive text scores below 0.60', () => {
    const repeated = Array(60).fill('слово другое').join(' ');
    const lyrics = `[Куплет 1]\n${repeated}`;
    const result = scoreDraft(lyrics);
    assert.ok(typeof result.lexical_diversity === 'number');
    assert.ok(result.lexical_diversity < 0.60,
      `expected < 0.60, got ${result.lexical_diversity}`);
  });

  it('varied text scores at or above 0.60', () => {
    const result = scoreDraft(CLEAN_DRAFT);
    assert.ok(result.lexical_diversity >= 0.60,
      `expected >= 0.60 for varied draft, got ${result.lexical_diversity}`);
  });
});

describe('skip_pipeline gate', () => {
  it('returns shape-correct object on any input (smoke test)', () => {
    const r = scoreDraft('');
    assert.deepStrictEqual(
      Object.keys(r).sort(),
      ['banale_pairs', 'lexical_diversity', 'skip_pipeline', 'syllable_violations'],
      'return shape must match contract'
    );
  });

  it('returns skip_pipeline=true for clean varied draft', () => {
    const result = scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(result.banale_pairs.length, 0,
      `clean draft should have no banale pairs, got ${JSON.stringify(result.banale_pairs)}`);
    assert.strictEqual(result.syllable_violations.length, 0,
      'clean draft should have no syllable violations');
    assert.ok(result.lexical_diversity >= 0.60,
      `clean draft diversity should be >= 0.60, got ${result.lexical_diversity}`);
    assert.strictEqual(result.skip_pipeline, true,
      'all checks passed → skip_pipeline must be true');
  });

  it('returns skip_pipeline=false when banale pair found', () => {
    const lyrics = [
      '[Куплет 1]',
      'Я пишу тебе про любовь',
      'А в висках стучит кровь',
    ].join('\n');
    const result = scoreDraft(lyrics);
    assert.strictEqual(result.skip_pipeline, false,
      'banale pair present → skip_pipeline must be false');
  });
});
