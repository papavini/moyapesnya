import { test } from 'node:test';
import assert from 'node:assert/strict';

test('hashIp returns same hash for same IP with same salt', async () => {
  process.env.IP_HASH_SALT = 'test-salt-aaa';
  const { hashIp } = await import('../services/ip-hash.js');
  const a = hashIp('1.2.3.4');
  const b = hashIp('1.2.3.4');
  assert.equal(a, b);
  assert.equal(a.length, 64); // SHA-256 hex
});

test('hashIp returns different hashes for different IPs', async () => {
  process.env.IP_HASH_SALT = 'test-salt-aaa';
  const { hashIp } = await import('../services/ip-hash.js');
  const a = hashIp('1.2.3.4');
  const b = hashIp('5.6.7.8');
  assert.notEqual(a, b);
});

test('hashIp throws when salt is empty', async () => {
  process.env.IP_HASH_SALT = '';
  // Cache-bust to force re-eval (module reads env at call time, but be safe)
  const mod = await import('../services/ip-hash.js?empty=' + Date.now());
  assert.throws(() => mod.hashIp('1.2.3.4'), /IP_HASH_SALT/);
});
