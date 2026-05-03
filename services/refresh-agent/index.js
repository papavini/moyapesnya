/**
 * Refresh agent — HTTP сервис на мини-ПК для удалённого обновления SUNO авторизации.
 *
 * Запускается на мини-ПК. Бот на Sber Cloud дёргает этот сервис через Tailscale,
 * когда нужен новый cookie или passkey (вместо локального CDP, которого на cloud нет).
 *
 * Биндится только на tailnet IP (по умолчанию 100.103.150.29) — недоступен из public/LAN.
 *
 * Endpoints:
 *   POST /refresh-cookie    — без body. Вызывает refreshCookie(). 200/{ok:true}.
 *   POST /refresh-passkey   — body { lyrics, tags, title } (real user data).
 *                              Вызывает refreshPasskeyToken([lyrics,tags,title]). 200/{ok:bool}.
 *   GET  /health            — { ok:true, busy, locked_by }.
 *
 * Refresh-операции сериализованы (CDP не любит concurrent сессии).
 */

import http from 'http';

const PORT = parseInt(process.env.REFRESH_AGENT_PORT || '3200', 10);
const HOST = process.env.REFRESH_AGENT_HOST || '100.103.150.29';

let inFlight = null;

async function withLock(name, fn) {
  while (inFlight) {
    console.log(`[refresh-agent] ${name}: waiting for ${inFlight.name} to finish...`);
    await inFlight.promise.catch(() => {});
  }
  let resolveLock;
  const promise = new Promise((r) => { resolveLock = r; });
  inFlight = { name, promise };
  try {
    return await fn();
  } finally {
    resolveLock();
    inFlight = null;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';
  const remote = req.socket.remoteAddress;
  console.log(`[refresh-agent] ${method} ${url} from ${remote}`);

  try {
    if (method === 'GET' && url === '/health') {
      return send(res, 200, {
        ok: true,
        busy: !!inFlight,
        locked_by: inFlight?.name || null,
      });
    }

    if (method === 'POST' && url === '/refresh-cookie') {
      await withLock('cookie', async () => {
        const { refreshCookie } = await import('../../src/suno/refresh-cookie.js');
        await refreshCookie();
      });
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && url === '/refresh-passkey') {
      const body = await readJson(req).catch(() => ({}));
      const fills = [
        String(body.lyrics || ''),
        String(body.tags || ''),
        String(body.title || ''),
      ];
      const ok = await withLock('passkey', async () => {
        const { refreshPasskeyToken } = await import('../../src/suno/refresh-passkey.js');
        return await refreshPasskeyToken(fills);
      });
      return send(res, ok ? 200 : 502, { ok });
    }

    return send(res, 404, { error: 'not found', url });
  } catch (e) {
    console.error(`[refresh-agent] ${method} ${url} failed:`, e.message);
    return send(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[refresh-agent] listening on ${HOST}:${PORT}`);
});

server.on('error', (e) => {
  console.error('[refresh-agent] server error:', e.message);
  if (e.code === 'EADDRNOTAVAIL') {
    console.error(`[refresh-agent] HOST ${HOST} не доступен на этом интерфейсе.`);
    console.error('[refresh-agent] Tailscale поднят? Проверь: ip addr show tailscale0');
    process.exit(1);
  }
  if (e.code === 'EADDRINUSE') {
    console.error(`[refresh-agent] порт ${PORT} занят.`);
    process.exit(1);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`[refresh-agent] received ${sig}, closing...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
