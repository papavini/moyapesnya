import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { config, assertWebConfig } from '../config.js';
import { db } from './db.js';
import { registerErrorHandler } from './middleware/error.js';
import { registerSessionMiddleware } from './middleware/session.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';

assertWebConfig();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  trustProxy: true, // we sit behind nginx
});

await app.register(cookie);
// CORS origin must be ASCII (HTTP header). new URL().origin punycode-encodes the host.
const corsOrigin = new URL(config.web.publicUrl).origin;
await app.register(cors, {
  origin: corsOrigin,
  credentials: true,
});

registerErrorHandler(app);
registerSessionMiddleware(app);

await registerHealthRoutes(app);
await registerAuthRoutes(app);

// Cleanup job: every hour delete expired sessions (guest songs CASCADE-drop with them)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const cleanupTimer = setInterval(() => {
  try {
    const expired = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes;
    if (expired > 0) {
      app.log.info({ expired_sessions: expired }, '[cleanup] removed expired sessions');
    }
  } catch (e) {
    app.log.error({ err: e }, '[cleanup] failed');
  }
}, CLEANUP_INTERVAL_MS);

async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  clearInterval(cleanupTimer);
  await app.close();
  db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: config.web.port, host: '127.0.0.1' });
  app.log.info({ port: config.web.port, apiPublicUrl: config.web.apiPublicUrl }, 'podari-web ready');
} catch (e) {
  app.log.error({ err: e }, 'failed to start');
  process.exit(1);
}
