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

  // Проактивное обновление passkey токена каждые 30 мин (без трат кредитов — Fetch.failRequest)
  const PASSKEY_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(async () => {
    try {
      console.log('[passkey-timer] проактивное обновление токена...');
      const { refreshPasskeyToken } = await import('./suno/refresh-passkey.js');
      const ok = await refreshPasskeyToken();
      console.log('[passkey-timer] результат:', ok ? 'OK' : 'FAILED');
    } catch (e) {
      console.log('[passkey-timer] ошибка:', e.message);
    }
  }, PASSKEY_REFRESH_INTERVAL_MS);

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
