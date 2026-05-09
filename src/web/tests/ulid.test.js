import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../services/ulid.js';

test('newId returns 26-char string', () => {
  const id = newId();
  assert.equal(typeof id, 'string');
  assert.equal(id.length, 26);
});

test('newId returns unique values', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(newId());
  assert.equal(ids.size, 1000);
});

test('newId is monotonic-ish (later id sorts after earlier id)', async () => {
  const a = newId();
  await new Promise(r => setTimeout(r, 5));
  const b = newId();
  assert.ok(b > a, `expected ${b} > ${a}`);
});
