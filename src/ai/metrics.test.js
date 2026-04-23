// Юнит-тесты для src/ai/metrics.js. Запуск: node --test src/ai/metrics.test.js
// Покрытие: METRICS-01 (банальные рифмы), METRICS-02 (слоги припева),
// METRICS-04 (MATTR-approx), gate skip_pipeline, и интеграция с рифмо-сайдкаром.
//
// Все тесты мокают globalThis.fetch (сайдкар не должен быть запущен для тестов).
// Дефолтный мок возвращает пустые buckets — проверяем что scoreDraft обрабатывает
// graceful degradation. Отдельные тесты переопределяют мок под нужный сценарий.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDraft } from './metrics.js';

// ── fetch mock infrastructure ──────────────────────────────────────────────
const originalFetch = globalThis.fetch;
let mockResponse = null; // { status, body } | Error | null (= connection refused)

function setMockRhymes({ trueR = [], approx = [], fake = [] } = {}) {
  mockResponse = {
    status: 200,
    body: { rhymes: { true: trueR, approximate: approx, fake } },
  };
}
function setMockError(err) {
  mockResponse = err;
}
function setMockStatus(status, body = {}) {
  mockResponse = { status, body };
}

before(() => {
  globalThis.fetch = async (_url, _opts) => {
    if (mockResponse instanceof Error) throw mockResponse;
    if (mockResponse === null) throw new Error('connection refused');
    const { status, body } = mockResponse;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
});

after(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  // дефолт — сайдкар живой, пустые buckets
  setMockRhymes();
});

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
  it('detects любовь/кровь pair from canonical cluster', async () => {
    const lyrics = [
      '[Куплет 1]',
      'Я пишу тебе про любовь',
      'А в висках стучит кровь',
    ].join('\n');
    const result = await scoreDraft(lyrics);
    assert.ok(Array.isArray(result.banale_pairs), 'banale_pairs must be array');
    assert.ok(result.banale_pairs.length >= 1, 'expected at least one banale pair');
    const flat = result.banale_pairs.flat();
    assert.ok(flat.includes('любовь'), 'expected любовь in flat pairs');
    assert.ok(flat.includes('кровь'), 'expected кровь in flat pairs');
  });

  it('detects розы/слёзы from morose cluster', async () => {
    const lyrics = [
      '[Куплет 1]',
      'Дарю тебе розы',
      'А в глазах стоят слёзы',
    ].join('\n');
    const result = await scoreDraft(lyrics);
    const flat = result.banale_pairs.flat();
    assert.ok(flat.includes('розы') && flat.includes('слёзы'),
      'expected розы/слёзы pair detected');
  });
});

describe('syllable violations (METRICS-02)', () => {
  it('flags chorus line over 12 syllables', async () => {
    const lyrics = [
      '[Куплет 1]',
      'Короткая строка',
      '[Припев]',
      'радиоактивный город заснял один фотограф у моря',
    ].join('\n');
    const result = await scoreDraft(lyrics);
    assert.ok(Array.isArray(result.syllable_violations));
    assert.ok(result.syllable_violations.length >= 1, 'expected violation');
    const v = result.syllable_violations[0];
    assert.ok(v.count > 12, `expected count > 12 got ${v.count}`);
    assert.ok(typeof v.line === 'string' && v.line.length > 0);
  });

  it('does not flag chorus line at exactly 12 syllables', async () => {
    const lyrics = [
      '[Куплет 1]',
      'Тут ничего нет',
      '[Припев]',
      'мама папа я сестра брат друг любовь',
    ].join('\n');
    const result = await scoreDraft(lyrics);
    assert.strictEqual(result.syllable_violations.length, 0,
      'expected no violations for short chorus line');
  });
});

describe('lexical diversity / MATTR (METRICS-04)', () => {
  it('repetitive text scores below 0.60', async () => {
    const repeated = Array(60).fill('слово другое').join(' ');
    const lyrics = `[Куплет 1]\n${repeated}`;
    const result = await scoreDraft(lyrics);
    assert.ok(typeof result.lexical_diversity === 'number');
    assert.ok(result.lexical_diversity < 0.60,
      `expected < 0.60, got ${result.lexical_diversity}`);
  });

  it('varied text scores at or above 0.60', async () => {
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.ok(result.lexical_diversity >= 0.60,
      `expected >= 0.60 for varied draft, got ${result.lexical_diversity}`);
  });
});

describe('skip_pipeline gate', () => {
  it('returns shape-correct object on any input (smoke test)', async () => {
    const r = await scoreDraft('');
    assert.deepStrictEqual(
      Object.keys(r).sort(),
      ['banale_pairs', 'lexical_diversity', 'rhymes', 'skip_pipeline', 'syllable_violations'],
      'return shape must match contract'
    );
    assert.deepStrictEqual(
      Object.keys(r.rhymes).sort(),
      ['approximate', 'fake', 'true'],
      'rhymes sub-shape must match contract'
    );
  });

  it('returns skip_pipeline=true for clean varied draft', async () => {
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(result.banale_pairs.length, 0,
      `clean draft should have no banale pairs, got ${JSON.stringify(result.banale_pairs)}`);
    assert.strictEqual(result.syllable_violations.length, 0,
      'clean draft should have no syllable violations');
    assert.ok(result.lexical_diversity >= 0.60,
      `clean draft diversity should be >= 0.60, got ${result.lexical_diversity}`);
    assert.strictEqual(result.skip_pipeline, true,
      'all checks passed → skip_pipeline must be true');
  });

  it('returns skip_pipeline=false when banale pair found', async () => {
    const lyrics = [
      '[Куплет 1]',
      'Я пишу тебе про любовь',
      'А в висках стучит кровь',
    ].join('\n');
    const result = await scoreDraft(lyrics);
    assert.strictEqual(result.skip_pipeline, false,
      'banale pair present → skip_pipeline must be false');
  });
});

// ── Rhyme detection integration (новый блок) ────────────────────────────────
describe('rhyme detection integration', () => {
  it('returns empty rhymes on sidecar timeout without throwing', async () => {
    setMockError(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.ok(result.rhymes, 'rhymes must be present even on sidecar failure');
    assert.strictEqual(result.rhymes.fake.length, 0);
    assert.strictEqual(result.rhymes.approximate.length, 0);
    assert.strictEqual(result.rhymes.true.length, 0);
  });

  it('returns empty rhymes on sidecar connection refused', async () => {
    setMockError(new Error('connection refused'));
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.deepStrictEqual(result.rhymes, { true: [], approximate: [], fake: [] });
  });

  it('returns empty rhymes on sidecar HTTP 500', async () => {
    setMockStatus(500, { error: 'internal' });
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(result.rhymes.fake.length, 0);
  });

  it('propagates fake rhymes from sidecar into scoreDraft output', async () => {
    setMockRhymes({
      trueR: [['путь', 'свернуть']],
      approx: [['готово', 'корона']],
      fake: [['всё', 'по-своему'], ['глаза', 'тебя']],
    });
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(result.rhymes.fake.length, 2);
    assert.deepStrictEqual(result.rhymes.fake[0], ['всё', 'по-своему']);
    assert.deepStrictEqual(result.rhymes.fake[1], ['глаза', 'тебя']);
    assert.strictEqual(result.rhymes.approximate.length, 1);
    assert.strictEqual(result.rhymes.true.length, 1);
  });

  it('skip_pipeline=false when fake rhymes present even if everything else is clean', async () => {
    setMockRhymes({
      trueR: [['путь', 'свернуть']],
      fake: [['глаза', 'тебя']],
    });
    const result = await scoreDraft(CLEAN_DRAFT);
    // убеждаемся что остальные метрики чистые
    assert.strictEqual(result.banale_pairs.length, 0);
    assert.strictEqual(result.syllable_violations.length, 0);
    assert.ok(result.lexical_diversity >= 0.60);
    // но fake rhymes ломают fast path
    assert.strictEqual(result.skip_pipeline, false,
      'fake rhyme present → skip_pipeline must be false');
  });

  it('skip_pipeline=true when only true/approximate rhymes present on clean draft', async () => {
    setMockRhymes({
      trueR: [['путь', 'свернуть'], ['разгон', 'трон']],
      approx: [['готово', 'корона']],
      fake: [],
    });
    const result = await scoreDraft(CLEAN_DRAFT);
    assert.strictEqual(result.skip_pipeline, true,
      'clean metrics + no fake rhymes → skip_pipeline=true');
  });
});
