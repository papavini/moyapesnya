import { createHash } from 'node:crypto';

export function hashIp(ip) {
  const salt = process.env.IP_HASH_SALT || '';
  if (!salt) {
    throw new Error('IP_HASH_SALT не задан — refusing to hash IP without salt');
  }
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex');
}
