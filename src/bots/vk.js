import { VK, Keyboard } from 'vk-io';
import { config, assertBotConfig } from '../config.js';
import { getSession, setState, resetSession } from '../store.js';
import { runGeneration } from '../flow/generate.js';
import { pingSuno, getCreditsLeft } from '../suno/client.js';

const PLATFORM = 'vk';

export function createVkBot() {
  assertBotConfig('vk');
  const vk = new VK({
    token: config.vk.token,
    pollingGroupId: config.vk.groupId,
  });

  vk.updates.on('message_new', async (ctx, next) => {
    try {
      await handleMessage(ctx);
    } catch (e) {
      console.error('[vk] ошибка обработчика:', e);
      try { await ctx.send('Что-то пошло не так, попробуй ещё раз.'); } catch {}
    }
    return next?.();
  });

  return vk;
}

async function handleMessage(ctx) {
  const userId = ctx.senderId;
  const raw = (ctx.text || '').trim();
  const text = raw;
  const lower = raw.toLowerCase();

  if (lower === '/start' || lower === 'начать' || lower === 'старт') {
    resetSession(PLATFORM, userId);
    const kb = Keyboard.builder()
      .textButton({ label: '🎵 По описанию', payload: { cmd: 'mode', v: 'description' } })
      .textButton({ label: '✍️ Свои стихи', payload: { cmd: 'mode', v: 'custom' } })
      .inline();
    await ctx.send({
      message:
        'Привет! Я делаю треки через SUNO.\n\n' +
        'Выбери режим:\n' +
        '• По описанию — опиши трек (жанр, настроение, тема).\n' +
        '• Свои стихи — дашь текст, жанр и название.',
      keyboard: kb,
    });
    return;
  }

  if (lower === '/ping' || lower === 'пинг') {
    const ok = await pingSuno();
    const credits = ok ? await getCreditsLeft() : null;
    await ctx.send(
      ok
        ? `SUNO на связи ✅${credits != null ? `\nКредитов: ${credits}` : ''}`
        : 'SUNO не отвечает ❌',
    );
    return;
  }

  if (lower === '/cancel' || lower === 'отмена') {
    resetSession(PLATFORM, userId);
    await ctx.send('Ок, отменил. Напиши «начать» чтобы заново.');
    return;
  }

  // Обработка payload от inline-клавиатуры
  const payload = ctx.messagePayload;
  if (payload?.cmd === 'mode') {
    if (payload.v === 'description') {
      setState(PLATFORM, userId, 'awaiting_prompt', { mode: 'description' });
      await ctx.send('Опиши трек одной-двумя фразами. Например: «грустный лоу-фай с женским вокалом про осень»');
    } else {
      setState(PLATFORM, userId, 'awaiting_lyrics', { mode: 'custom' });
      await ctx.send('Пришли текст песни:');
    }
    return;
  }

  const session = getSession(PLATFORM, userId);

  if (session.state === 'awaiting_prompt') {
    setState(PLATFORM, userId, 'generating');
    await handleGenerate(ctx, { mode: 'description', prompt: text });
    return;
  }

  if (session.state === 'awaiting_lyrics') {
    setState(PLATFORM, userId, 'awaiting_style', { lyrics: text });
    await ctx.send('Теперь жанр/стиль через запятую. Например: pop, acoustic, female vocal');
    return;
  }

  if (session.state === 'awaiting_style') {
    setState(PLATFORM, userId, 'awaiting_title', { tags: text });
    await ctx.send('И название трека:');
    return;
  }

  if (session.state === 'awaiting_title') {
    const { lyrics, tags } = session.data;
    setState(PLATFORM, userId, 'generating', { title: text });
    await handleGenerate(ctx, { mode: 'custom', lyrics, tags, title: text });
    return;
  }

  if (session.state === 'generating') {
    await ctx.send('Я ещё делаю предыдущий трек, подожди 🎧');
    return;
  }

  await ctx.send('Напиши «начать» чтобы выбрать режим.');
}

async function handleGenerate(ctx, opts) {
  await ctx.send('⏳ Готовлю задание…');
  let lastText = '';

  const updateStatus = async (text) => {
    if (text === lastText) return;
    lastText = text;
    try { await ctx.send(`⏳ ${text}`); } catch {}
  };

  const result = await runGeneration({ ...opts, onStatus: updateStatus });
  resetSession(PLATFORM, ctx.senderId);

  if (!result.ok) {
    await ctx.send(`❌ ${result.error}`);
    return;
  }

  await ctx.send(`Готово! Треков: ${result.clips.length}`);
  for (const clip of result.clips) {
    const parts = [];
    if (clip.title) parts.push(`🎵 ${clip.title}`);
    if (clip.audioUrl) parts.push(clip.audioUrl);
    await ctx.send(parts.join('\n'));
  }
}
