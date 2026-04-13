import 'dotenv/config';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(v, fallback = false) {
  if (v == null) return fallback;
  return String(v).toLowerCase() === 'true';
}

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
  },
  vk: {
    token: process.env.VK_GROUP_TOKEN || '',
    groupId: process.env.VK_GROUP_ID ? Number(process.env.VK_GROUP_ID) : 0,
  },
  suno: {
    base: (process.env.SUNO_API_BASE || 'http://localhost:3000').replace(/\/+$/, ''),
    pollTimeoutSec: num(process.env.SUNO_POLL_TIMEOUT_SEC, 240),
    pollIntervalSec: num(process.env.SUNO_POLL_INTERVAL_SEC, 5),
    sendFirstOnly: bool(process.env.SUNO_SEND_FIRST_ONLY, false),
  },
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.AI_MODEL || 'anthropic/claude-sonnet-4.6',
    baseUrl: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  },
  robokassa: {
    merchantId: process.env.ROBOKASSA_MERCHANT_ID || '',
    pass1: process.env.ROBOKASSA_PASSWORD1 || '',
    pass2: process.env.ROBOKASSA_PASSWORD2 || '',
    testMode: bool(process.env.ROBOKASSA_TEST_MODE, true),
  },
  songPrice: num(process.env.SONG_PRICE, 299),
  webhookPort: num(process.env.WEBHOOK_PORT, 8080),
  webhookHost: process.env.WEBHOOK_HOST || '',
  paywallEnabled: bool(process.env.PAYWALL_ENABLED, false),
};

export function assertBotConfig(which) {
  if (which === 'telegram' && !config.telegram.token) {
    throw new Error('TELEGRAM_BOT_TOKEN не задан в .env');
  }
  if (which === 'vk' && (!config.vk.token || !config.vk.groupId)) {
    throw new Error('VK_GROUP_TOKEN / VK_GROUP_ID не заданы в .env');
  }
}
