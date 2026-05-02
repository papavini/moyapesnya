import { createServer } from 'http';
import { parse } from 'url';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';
import { verifyResult, createInvoiceUrl, generateInvId } from '../payment/robokassa.js';
import { getPayment, setPaymentStatus, setPayment } from '../store.js';
import { runPipeline } from '../ai/pipeline.js';
import { runGeneration } from '../flow/generate.js';

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
        resolve(JSON.parse(body));
      } catch {
        try {
          resolve(Object.fromEntries(new URLSearchParams(body)));
        } catch {
          resolve({});
        }
      }
    });
  });
}

export function startWebhookServer() {
  const port = config.webhookPort;

  const server = createServer(async (req, res) => {
    const { pathname, query } = parse(req.url, true);

    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // API: Создание текста песни (AI Pipeline)
    if (pathname === '/api/generate-lyrics' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const { occasion, genre, mood, voice, wishes } = body;

        console.log(`[api] Generating lyrics for occasion: ${occasion}, genre: ${genre}`);
        const aiResult = await runPipeline({ occasion, genre, mood, voice, wishes });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, lyrics: aiResult.lyrics, tags: aiResult.tags, title: aiResult.title }));
      } catch (e) {
        console.error('[api] Generate lyrics error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // API: Создание ссылки на оплату
    if (pathname === '/api/create-payment' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const { lyrics, tags, title, price, name, email, telegram } = body;

        // Создаём уникальный идентификатор заказа
        const invId = generateInvId(Math.floor(Math.random() * 100000));
        const amount = Number(price) || config.songPrice;
        const payUrl = createInvoiceUrl(invId, amount, 'Песня — Подари Песню!');

        const paymentData = {
          platform: 'web',
          userId: email || name || 'web_user',
          lyrics, tags, title,
          amount, name, email, telegram,
          clips: null,
          status: 'pending'
        };

        setPayment(invId, paymentData);
        console.log(`[api] Payment created for ${email}, invId=${invId}, amount=${amount}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, payUrl, invId }));
      } catch (e) {
        console.error('[api] Create payment error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    // API: Статус платежа и песни
    if (pathname === '/api/payment-status' && req.method === 'GET') {
      try {
        const invId = String(query.invId || '');
        const payment = getPayment(invId);

        if (!payment) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Payment not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: payment.status, clips: payment.clips }));
      } catch (e) {
        console.error('[api] Payment status error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

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

      // Запускаем генерацию песни в фоне
      runGeneration({
        mode: 'custom',
        lyrics: payment.lyrics,
        tags: payment.tags,
        title: payment.title,
      }).then((result) => {
        if (result.ok) {
          payment.clips = result.clips;
          console.log(`[webhook] Generation successful for invId=${invId}, clips=${result.clips.length}`);
        } else {
          console.error(`[webhook] Generation error for invId=${invId}:`, result.error);
        }
      }).catch((e) => {
        console.error(`[webhook] Generation exception for invId=${invId}:`, e.message);
      });

      // Также вызываем Telegram-бот callback (если есть)
      if (onPaymentConfirmed) {
        onPaymentConfirmed(payment).catch((e) =>
          console.error('[webhook] callback error:', e.message));
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`OK${invId}`);
      return;
    }

    // Success URL — пользователь вернулся после оплаты
    if (pathname === '/robokassa/success') {
      const invId = String(query.InvId || '');
      // Redirect to website success page
      res.writeHead(302, { Location: `/success.html?invId=${invId}` });
      res.end();
      return;
    }

    // Fail URL — оплата не прошла
    if (pathname === '/robokassa/fail') {
      res.writeHead(302, { Location: '/index.html#order' });
      res.end();
      return;
    }

    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Static file serving from the ../../site directory
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const siteDir = resolve(__dirname, '..', '..', 'site');

    let filePath = resolve(siteDir, pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''));

    // Prevent directory traversal & only serve if within siteDir
    if (filePath.startsWith(siteDir) && existsSync(filePath)) {
      const ext = extname(filePath).toLowerCase();
      let contentType = 'text/html; charset=utf-8';
      if (ext === '.css') contentType = 'text/css';
      if (ext === '.js') contentType = 'text/javascript';
      if (ext === '.png') contentType = 'image/png';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      if (ext === '.svg') contentType = 'image/svg+xml';
      if (ext === '.mp3') contentType = 'audio/mpeg';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(port, () => {
    console.log(`[webhook] сервер запущен на :${port}`);
  });

  return server;
}
