import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AUTH_AGE_SEC = 86400; // 24 hours

export function verifyTelegramHash(payload, botToken) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.hash !== 'string' || payload.hash.length !== 64) return false;
  if (typeof payload.id !== 'number' && typeof payload.id !== 'string') return false;
  if (typeof payload.auth_date !== 'number' && typeof payload.auth_date !== 'string') return false;

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > MAX_AUTH_AGE_SEC) return false;

  // Build data_check_string from all fields except `hash`, sorted alphabetically.
  const keys = Object.keys(payload).filter(k => k !== 'hash').sort();
  const dataCheckString = keys.map(k => `${k}=${payload[k]}`).join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare to avoid timing attacks
  const expBuf = Buffer.from(expected, 'hex');
  const gotBuf = Buffer.from(payload.hash, 'hex');
  if (expBuf.length !== gotBuf.length) return false;
  return timingSafeEqual(expBuf, gotBuf);
}
