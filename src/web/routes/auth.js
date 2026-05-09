import { config } from '../../config.js';
import { db } from '../db.js';
import { verifyTelegramHash } from '../services/telegram-login.js';
import { rotateOnLogin, deleteSession } from '../services/session-store.js';
import { hashIp } from '../services/ip-hash.js';
import { unauthorized, badRequest } from '../lib/http-errors.js';
import { clearSessionCookie } from '../middleware/session.js';

function avatarInitials(firstName = '', lastName = '') {
  const a = (firstName.trim()[0] || '').toUpperCase();
  const b = (lastName.trim()[0] || '').toUpperCase();
  return (a + b) || '??';
}

const callbackBodySchema = {
  type: 'object',
  required: ['id', 'first_name', 'auth_date', 'hash'],
  properties: {
    id:         { type: ['integer', 'string'] },
    first_name: { type: 'string', maxLength: 200 },
    last_name:  { type: 'string', maxLength: 200 },
    username:   { type: 'string', maxLength: 200 },
    photo_url:  { type: 'string', maxLength: 500 },
    auth_date:  { type: ['integer', 'string'] },
    hash:       { type: 'string', minLength: 64, maxLength: 64 },
  },
  additionalProperties: false,
};

export async function registerAuthRoutes(app) {
  app.get('/api/auth/me', async (req) => {
    if (req.user) {
      return {
        guest: false,
        user: {
          display_name:    req.user.display_name,
          avatar_initials: req.user.avatar_initials,
        },
      };
    }
    return { guest: true };
  });

  app.post('/api/auth/telegram/callback', { schema: { body: callbackBodySchema } }, async (req, reply) => {
    const payload = req.body;
    if (!verifyTelegramHash(payload, config.telegram.token)) {
      throw unauthorized('Invalid Telegram signature', 'TELEGRAM_HMAC_INVALID');
    }

    const telegramId = Number(payload.id);
    if (!Number.isFinite(telegramId)) {
      throw badRequest('Invalid Telegram id', 'TELEGRAM_ID_INVALID');
    }

    const displayName = payload.first_name + (payload.last_name ? ' ' + payload.last_name : '');
    const initials = avatarInitials(payload.first_name, payload.last_name || '');
    const now = Date.now();

    // Upsert user
    db.prepare(`
      INSERT INTO users (telegram_id, display_name, avatar_initials, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name    = excluded.display_name,
        avatar_initials = excluded.avatar_initials,
        last_seen_at    = excluded.last_seen_at
    `).run(telegramId, displayName, initials, now, now);

    const user = db.prepare('SELECT id, display_name, avatar_initials FROM users WHERE telegram_id = ?').get(telegramId);

    const ipHash = req.ip ? hashIp(req.ip) : null;
    const ua = req.headers['user-agent'] || null;
    const { newSid, migratedSongsCount } = rotateOnLogin(db, req.session.id, user.id, { userAgent: ua, ipHash });

    reply.setCookie(config.web.cookieName, newSid, {
      domain: config.web.cookieDomain,
      httpOnly: true,
      secure: config.web.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(config.web.sessionLifetimeAuthMs / 1000),
    });

    return {
      ok: true,
      user: {
        display_name:    user.display_name,
        avatar_initials: user.avatar_initials,
      },
      migrated_songs_count: migratedSongsCount,
    };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.session) deleteSession(db, req.session.id);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
