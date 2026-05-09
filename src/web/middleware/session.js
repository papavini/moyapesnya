import { config } from '../../config.js';
import { db } from '../db.js';
import { findSession, createGuestSession, touchSession } from '../services/session-store.js';
import { hashIp } from '../services/ip-hash.js';

const COOKIE_OPTS = {
  domain: config.web.cookieDomain,
  httpOnly: true,
  secure: config.web.cookieSecure,
  sameSite: 'lax',
  path: '/',
};

function cookieMaxAge(isAuth) {
  const ms = isAuth ? config.web.sessionLifetimeAuthMs : config.web.sessionLifetimeGuestMs;
  return Math.floor(ms / 1000);
}

export function registerSessionMiddleware(app) {
  app.addHook('onRequest', async (req, reply) => {
    const sidFromCookie = req.cookies[config.web.cookieName];
    let session = sidFromCookie ? findSession(db, sidFromCookie) : null;

    // Expired? Treat as missing
    if (session && session.expires_at < Date.now()) {
      session = null;
    }

    if (!session) {
      const ua = req.headers['user-agent'] || null;
      const ipHash = req.ip ? hashIp(req.ip) : null;
      const newSid = createGuestSession(db, { userAgent: ua, ipHash });
      session = findSession(db, newSid);
      reply.setCookie(config.web.cookieName, newSid, {
        ...COOKIE_OPTS,
        maxAge: cookieMaxAge(false),
      });
    } else {
      touchSession(db, session.id);
      // Re-set cookie to keep maxAge sliding for auth sessions in browser
      if (session.user_id != null) {
        reply.setCookie(config.web.cookieName, session.id, {
          ...COOKIE_OPTS,
          maxAge: cookieMaxAge(true),
        });
      }
    }

    req.session = session;
    req.user = null;
    if (session.user_id != null) {
      req.user = db.prepare('SELECT id, telegram_id, email, display_name, avatar_initials FROM users WHERE id = ?').get(session.user_id);
    }
  });
}

export function clearSessionCookie(reply) {
  reply.setCookie(config.web.cookieName, '', {
    ...COOKIE_OPTS,
    maxAge: 0,
  });
}
