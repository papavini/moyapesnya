import { createServer } from 'http';
import { parse } from 'url';
import { config } from '../config.js';
import { verifyResult } from '../payment/robokassa.js';
import { getPayment, setPaymentStatus } from '../store.js';

let onPaymentConfirmed = null;

/**
 * Регистрирует callback, который вызывается при подтверждении оплаты.
 * @param {(payment: {platform, userId, invId, orderId, lyrics, tags, title}) => Promise<void>} fn
 */
export function onPayment(fn) {
  onPaymentConfirmed = fn;
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        // Robokassa шлёт как form-urlencoded
        resolve(Object.fromEntries(new URLSearchParams(body)));
      } catch {
        resolve({});
      }
    });
  });
}

export function startWebhookServer() {
  const port = config.webhookPort;

  const server = createServer(async (req, res) => {
    const { pathname, query } = parse(req.url, true);

    // Robokassa Result URL — подтверждение оплаты (server-to-server)
    if (pathname === '/robokassa/result') {
      const params = req.method === 'POST' ? await parseBody(req) : query;
      const invId = String(params.InvId || '');

      console.log(`[webhook] Result: InvId=${invId} OutSum=${params.OutSum}`);

      if (!verifyResult(params)) {
        console.log('[webhook] signature INVALID');
        res.writeHead(400); res.end('bad signature');
        return;
      }

      const payment = getPayment(invId);
      if (!payment) {
        console.log(`[webhook] payment not found for InvId=${invId}`);
        res.writeHead(200); res.end(`OK${invId}`);
        return;
      }

      setPaymentStatus(invId, 'paid');
      console.log(`[webhook] payment CONFIRMED for user ${payment.userId}`);

      // Запускаем генерацию песни
      if (onPaymentConfirmed) {
        onPaymentConfirmed(payment).catch((e) =>
          console.error('[webhook] generation error:', e.message));
      }

      // Robokassa требует ответ OK{InvId}
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`OK${invId}`);
      return;
    }

    // Success URL — пользователь вернулся после оплаты
    if (pathname === '/robokassa/success') {
      res.writeHead(302, { Location: 'https://t.me/podaripesniu_bot' });
      res.end();
      return;
    }

    // Fail URL — оплата не прошла
    if (pathname === '/robokassa/fail') {
      res.writeHead(302, { Location: 'https://t.me/podaripesniu_bot' });
      res.end();
      return;
    }

    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404); res.end('not found');
  });

  server.listen(port, () => {
    console.log(`[webhook] сервер запущен на :${port}`);
  });

  return server;
}
