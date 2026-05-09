import { HttpError } from '../lib/http-errors.js';

export function registerErrorHandler(app) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.status).send({ ok: false, error: err.message, code: err.code });
      return;
    }
    // Unknown errors: log full detail, return generic 500 (don't leak internals)
    req.log.error({ err }, 'unhandled error');
    reply.code(500).send({ ok: false, error: 'Internal Server Error', code: 'INTERNAL' });
  });
}
