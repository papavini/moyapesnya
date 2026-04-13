import { config } from './config.js';
import { createTelegramBot } from './bots/telegram.js';
import { createVkBot } from './bots/vk.js';
import { pingSuno } from './suno/client.js';
import { startWebhookServer, onPayment } from './server/webhook.js';

function parseOnly(argv) {
  const arg = argv.find((a) => a.startsWith('--only='));
  return arg ? arg.split('=')[1] : null;
}

async function main() {
  const only = parseOnly(process.argv.slice(2));

  const wantTg = (!only || only === 'telegram') && !!config.telegram.token;
  const wantVk = (!only || only === 'vk') && !!config.vk.token && !!config.vk.groupId;

  if (!wantTg && !wantVk) {
    console.error('Ни один бот не сконфигурирован. Проверь .env.');
    process.exit(1);
  }

  // Предварительный ping SUNO — не фатально, просто лог.
  const sunoOk = await pingSuno();
  console.log(sunoOk
    ? `[suno] ok -> ${config.suno.base}`
    : `[suno] не отвечает -> ${config.suno.base} (бот всё равно запустится, команды генерации провалятся)`);

  // Проактивное обновление passkey токена (без трат кредитов — Fetch.failRequest)
  // ВАЖНО: P1_ живёт ~30 мин в React state браузера. Если истёк → нужна активная сессия в браузере.
  // Timer срабатывает пока P1_ ещё валиден → успешно перехватывает свежий токен.
  const runPasskeyRefresh = async (label) => {
    try {
      console.log(`[passkey-timer] ${label}...`);
      const { refreshPasskeyToken } = await import('./suno/refresh-passkey.js');
      const ok = await refreshPasskeyToken();
      if (ok) {
        console.log(`[passkey-timer] ${label}: OK`);
      } else {
        console.log(`[passkey-timer] ${label}: FAILED — P1_ истёк в браузере. Запустите: node /tmp/get_token_v2.mjs`);
      }
    } catch (e) {
      console.log(`[passkey-timer] ${label} ошибка:`, e.message);
    }
  };

  // Сразу при старте (через 10s) — пока P1_ ещё свежий
  setTimeout(() => runPasskeyRefresh('старт'), 10000);
  // Затем каждые 25 мин — раньше истечения 30-минутного окна
  setInterval(() => runPasskeyRefresh('плановое обновление'), 25 * 60 * 1000);

  const shutdowns = [];

  if (wantTg) {
    try {
      const tg = createTelegramBot();
      tg.start({
        onStart: (botInfo) => console.log(`[telegram] @${botInfo.username} запущен (long-polling)`),
      }).catch((e) => console.error('[telegram] crashed:', e));
      shutdowns.push(() => tg.stop());

      // Webhook для оплаты → авто-генерация
      if (config.paywallEnabled && config.robokassa.merchantId) {
        onPayment(async (payment) => {
          if (payment.platform === 'tg' && tg._handlePaidGeneration) {
            await tg._handlePaidGeneration(payment);
          }
        });
        startWebhookServer();
      }
    } catch (e) {
      console.error('[telegram] старт провалился:', e.message);
    }
  } else if (!only || only === 'telegram') {
    console.log('[telegram] пропускаю: TELEGRAM_BOT_TOKEN не задан');
  }

  if (wantVk) {
    try {
      const vk = createVkBot();
      await vk.updates.start();
      console.log(`[vk] long-polling запущен для группы ${config.vk.groupId}`);
      shutdowns.push(() => vk.updates.stop());
    } catch (e) {
      console.error('[vk] старт провалился:', e.message);
    }
  } else if (!only || only === 'vk') {
    console.log('[vk] пропускаю: VK_GROUP_TOKEN / VK_GROUP_ID не заданы');
  }

  const graceful = async (sig) => {
    console.log(`\nПолучил ${sig}, останавливаю ботов…`);
    await Promise.allSettled(shutdowns.map((fn) => fn()));
    process.exit(0);
  };
  process.once('SIGINT', () => graceful('SIGINT'));
  process.once('SIGTERM', () => graceful('SIGTERM'));
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
