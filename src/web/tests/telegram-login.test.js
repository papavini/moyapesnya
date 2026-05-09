import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { verifyTelegramHash } from '../services/telegram-login.js';

const TEST_BOT_TOKEN = '123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';

function buildValidPayload(userFields, botToken = TEST_BOT_TOKEN) {
  // Telegram algorithm:
  // 1. data_check_string = sorted "key=value" lines joined by \n (excluding hash)
  // 2. secret_key = SHA-256(bot_token)
  // 3. hash = HMAC-SHA256(secret_key, data_check_string)
  const dataCheckString = Object.keys(userFields).sort()
    .map(k => `${k}=${userFields[k]}`).join('\n');
  const secretKey = createHash('sha256').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return { ...userFields, hash };
}

test('verifyTelegramHash returns true for valid payload', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), true);
});

test('verifyTelegramHash returns false when hash is tampered', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  payload.hash = '0'.repeat(64);
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when payload field is tampered', () => {
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: Math.floor(Date.now() / 1000),
  };
  const payload = buildValidPayload(fields);
  payload.first_name = 'AttackerInjected';
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when auth_date is older than 24h', () => {
  const stale = Math.floor(Date.now() / 1000) - 86401; // 24h + 1s
  const fields = {
    id: 12345678,
    first_name: 'Test',
    auth_date: stale,
  };
  const payload = buildValidPayload(fields);
  assert.equal(verifyTelegramHash(payload, TEST_BOT_TOKEN), false);
});

test('verifyTelegramHash returns false when payload missing required fields', () => {
  assert.equal(verifyTelegramHash(null, TEST_BOT_TOKEN), false);
  assert.equal(verifyTelegramHash({}, TEST_BOT_TOKEN), false);
  assert.equal(verifyTelegramHash({ id: 1 }, TEST_BOT_TOKEN), false); // no hash
  assert.equal(verifyTelegramHash({ hash: 'x', auth_date: 1 }, TEST_BOT_TOKEN), false); // no id
});
