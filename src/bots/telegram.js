import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config, assertBotConfig } from '../config.js';
import { getSession, setState, resetSession } from '../store.js';
import { runGeneration } from '../flow/generate.js';
import { pingSuno, getCreditsLeft } from '../suno/client.js';
import { generateLyrics } from '../ai/client.js';
import { createInvoiceUrl, generateInvId } from '../payment/robokassa.js';
import { setPayment, getPayment, findPaymentByUser } from '../store.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WELCOME_VIDEO_PATH = resolve(__dirname, '..', 'assets', 'welcome.mp4');
const FILE_ID_CACHE = resolve(__dirname, '..', 'assets', '.video_file_id');
let welcomeVideoFileId = null;
try { welcomeVideoFileId = readFileSync(FILE_ID_CACHE, 'utf8').trim() || null; } catch {}

const PLATFORM = 'tg';

const WELCOME =
  '<blockquote>🏛 Добро пожаловать в <b>сервис №1</b> по созданию персональных песен на заказ — <b>Подари Песню!</b>\n\n' +
  '🎤 Создайте песню за 5 минут по любой вашей истории, которая станет незабываемым <b>ВАУ-подарком</b> для вас и ваших близких❤️\n\n' +
  '🎬 А также под песни мы делаем волшебные анимированные <b>видео-мультфильмы из ваших фотографий</b>✨\n\n' +
  '❌ Вам не нужно петь\n' +
  '❌ Не нужно придумывать слова\n\n' +
  '✅ Ответьте на 5 простых вопросов и получите уникальный текст к вашей песне совершенно бесплатно уже через 3 минуты!\n\n' +
  '📝 Если понравится текст — вы сразу сможете <b>превратить его в настоящую песню!</b>\n\n' +
  '😁 За 11 лет работы мы подарили более 500.000+ клиентам самые незабываемые эмоции с помощью песен! Удивим и вас🔥\n\n' +
  '— Ну что? Начнем? 🥹</blockquote>';

const WISHES_PROMPT =
  '<blockquote>🎤 <b>Последний шаг к созданию вашей песни!</b>\n\n' +
  'Напишите всего несколько фактов о получателе❤️\n\n' +
  '✏️ Имя получателя песни и кем он вам приходится\n' +
  '🥰 Какие эмоции хотите передать (любовь, благодарность, юмор и т.д.)\n' +
  '🤔 То, что знаете только вы: забавные случаи, любимые фразы\n' +
  '🌟 Что делает его особенным: привычки, за что вы его любите, как по-своему называете\n\n' +
  '⚠️ <i>Самое главное: Не усложняйте! Хватит несколько простых фактов!</i>\n\n' +
  '📝 Напишите текстом, или надиктуйте голосом 🎙 свои пожелания к песне в ответ на это сообщение☝️</blockquote>';

const EXAMPLES_TEXT =
  'Пример 1.\n\n' +
  '🥰 <b>Мужу Диме на день рождения</b>\n\n' +
  'Вместе 21 год. Знакомы со школы, Дима покорил меня песней на гитаре) Зову его "радость моя", а он меня "кОтя". Сын Даня и дочка Анжелика. Даня поступил в университет в Питере. Анжелика обожает ездить на рыбалку с папой. Мы его очень сильно любим!\n\n' +
  'Пример 2.\n\n' +
  '🤲 <b>Для жены Ольги на юбилей</b>\n\n' +
  'Познакомились с Оленькой на работе, она повар. Первое свидание в кино, в 2013 поженились. В 2015 родилась дочь Алёна, наша звёздочка! Оля обожает цветы и кота рыжика. Люблю их с дочкой и буду всегда для них опорой.\n\n' +
  'Пример 3.\n\n' +
  '💃 <b>Для подруги Лизы</b>\n\n' +
  'Она светит как солнце! Обожает своего кота Васю и кофе с корицей. Любимая фраза «Сама решу»)) Хочу, чтобы песня была тёплой, как наши вечерние разговоры. Повод — её день рождения 🎂\n\n' +
  '📝 <i>Напишите текстом, или надиктуйте голосом 🎙 свои пожелания к песне в ответ на это сообщение☝️</i>';

function q1Keyboard() {
  return new InlineKeyboard()
    .text('🎂 День рождения', 'q1:День рождения')
    .text('🎵 Без повода', 'q1:Без повода')
    .row()
    .text('🎈 Юбилей', 'q1:Юбилей')
    .text('📅 Дата отношений', 'q1:Дата отношений')
    .row()
    .text('💍 Свадьба', 'q1:Свадьба')
    .text('💑 Годовщина', 'q1:Годовщина')
    .row()
    .text('✈️ На расстоянии', 'q1:На расстоянии')
    .text('😂 Розыгрыш', 'q1:Розыгрыш')
    .row()
    .text('🙏 Попросить прощения', 'q1:Попросить прощения')
    .row()
    .text('✏️ Свой вариант', 'q1:custom');
}

function q2Keyboard() {
  return new InlineKeyboard()
    .text('🎙 Поп-музыка', 'q2:поп-музыка')
    .text('🤘 Рок', 'q2:рок')
    .row()
    .text('🎤 Рэп / Хип-хоп', 'q2:рэп, хип-хоп')
    .text('🥃 Шансон', 'q2:шансон')
    .row()
    .text('🏰 В стиле Disney', 'q2:Disney, сказочный')
    .text('🎸 Под гитару', 'q2:акустика, гитара')
    .row()
    .text('💃 Танцевальная музыка', 'q2:танцевальный, электронный')
    .row()
    .text('✏️ Свой стиль', 'q2:custom');
}

function q3Keyboard() {
  return new InlineKeyboard()
    .text('🥹 Сентиментальное, лиричное', 'q3:сентиментальное, лиричное')
    .row()
    .text('🥰 Радостное, позитивное', 'q3:радостное, позитивное')
    .row()
    .text('😘 Романтичное', 'q3:романтичное')
    .row()
    .text('🧞 На наше усмотрение', 'q3:любое');
}

function q4Keyboard() {
  return new InlineKeyboard()
    .text('🎙 Мужским', 'q4:мужской вокал').danger()
    .text('🎤 Женским', 'q4:женский вокал').success();
}

function wishesKeyboard() {
  return new InlineKeyboard().text('📋 Показать пример пожеланий', 'show_examples');
}

function buildPrompt({ occasion, genre, mood, voice, wishes }) {
  return (
    `Создай полноценную душевную песню на русском языке. ` +
    `Повод: ${occasion}. ` +
    `Жанр: ${genre}. ` +
    `Настроение: ${mood}. ` +
    `${voice}. ` +
    `Пожелания и история: ${wishes}. ` +
    `Сделай трогательно, с припевом, куплетами и бриджем. Упомяни имя и детали из истории.`
  );
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function heartProgress(percent) {
  const total = 7;
  const filled = Math.round((percent / 100) * total);
  return '❤️'.repeat(filled) + '🖤'.repeat(total - filled) + ` ${percent}%`;
}

export function createTelegramBot() {
  assertBotConfig('telegram');
  const bot = new Bot(config.telegram.token);

  // /start
  bot.command('start', async (ctx) => {
    resetSession(PLATFORM, ctx.from.id);
    try {
      const video = welcomeVideoFileId || new InputFile(WELCOME_VIDEO_PATH);
      const sent = await ctx.replyWithVideo(video, {
        caption: WELCOME,
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🎤 Создать свою песню', 'create').danger(),
      });
      if (!welcomeVideoFileId && sent.video) {
        welcomeVideoFileId = sent.video.file_id;
        try { writeFileSync(FILE_ID_CACHE, welcomeVideoFileId); } catch {}
        console.log('[telegram] видео закешировано:', welcomeVideoFileId.substring(0, 30) + '...');
      }
    } catch (e) {
      console.error('[telegram] видео не отправилось:', e.message);
      await ctx.reply(WELCOME, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('🎤 Создать свою песню', 'create').danger(),
      });
    }
  });

  // Кнопка "Создать свою песню" → Вопрос 1/5
  bot.callbackQuery('create', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
    setState(PLATFORM, ctx.from.id, 'awaiting_occasion');
    await ctx.reply(
      'Вопрос 1/5. На какое событие вы хотите подарить песню?\n\n' +
        '<i>Можете выбрать из списка, или написать свой вариант☝️</i>',
      { parse_mode: 'HTML', reply_markup: q1Keyboard() },
    );
  });

  // Вопрос 1 — событие
  bot.callbackQuery(/^q1:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const val = ctx.match[1];
    if (val === 'custom') {
      setState(PLATFORM, ctx.from.id, 'awaiting_occasion_custom');
      await ctx.reply('✏️ Напишите свой вариант события, или надиктуйте голосом 🎙');
      return;
    }
    setState(PLATFORM, ctx.from.id, 'awaiting_genre', { occasion: val });
    await ctx.reply('Вопрос 2/5. Выберите жанр для вашей песни☝️', {
      reply_markup: q2Keyboard(),
    });
  });

  // Вопрос 2 — жанр
  bot.callbackQuery(/^q2:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const val = ctx.match[1];
    if (val === 'custom') {
      setState(PLATFORM, ctx.from.id, 'awaiting_genre_custom');
      await ctx.reply('✏️ Опишите стиль музыки словами, или надиктуйте голосом 🎙\n\nНапример: «лёгкий джаз с саксофоном» или «как у Земфиры»');
      return;
    }
    setState(PLATFORM, ctx.from.id, 'awaiting_mood', { genre: val });
    await ctx.reply(
      'Вопрос 3/5. Отлично! Теперь выберите настроение для вашей песни☝️',
      { reply_markup: q3Keyboard() },
    );
  });

  // Вопрос 3 — настроение
  bot.callbackQuery(/^q3:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    setState(PLATFORM, ctx.from.id, 'awaiting_voice', { mood: ctx.match[1] });
    await ctx.reply('Вопрос 4/5. Каким голосом будем исполнять вашу песню☝️', {
      reply_markup: q4Keyboard(),
    });
  });

  // Вопрос 4 — голос
  bot.callbackQuery(/^q4:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    setState(PLATFORM, ctx.from.id, 'awaiting_wishes', { voice: ctx.match[1] });
    await ctx.reply(WISHES_PROMPT, {
      parse_mode: 'HTML',
      reply_markup: wishesKeyboard(),
    });
  });

  // Подтверждение → AI генерирует текст → показывает с кнопками
  bot.callbackQuery('confirm_create', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const session = getSession(PLATFORM, ctx.from.id);
    console.log('[telegram] confirm_create, state:', session.state, 'data keys:', Object.keys(session.data));
    const { occasion, genre, mood, voice, wishes } = session.data;

    const lyricsMsg = await ctx.reply('✍️ Сочиняю текст вашей песни…');
    let aiResult;
    try {
      console.log('[telegram] calling generateLyrics...');
      aiResult = await generateLyrics({ occasion, genre, mood, voice, wishes });
      console.log('[telegram] AI OK, lyrics:', aiResult.lyrics?.substring(0, 50));
    } catch (e) {
      console.error('[telegram] AI ошибка:', e.message, e.stack?.substring(0, 200));
      await ctx.api.editMessageText(lyricsMsg.chat.id, lyricsMsg.message_id,
        '⚠️ Генератор текста временно недоступен, создаём по описанию…');
      setState(PLATFORM, ctx.from.id, 'generating');
      await handleGenerate(ctx, {
        mode: 'description',
        prompt: buildPrompt({ occasion, genre, mood, voice, wishes }),
      });
      return;
    }

    // Сохраняем текст в сессию
    setState(PLATFORM, ctx.from.id, 'review_lyrics', {
      lyrics: aiResult.lyrics,
      tags: aiResult.tags,
      title: aiResult.title,
    });

    // Показываем текст + мотивация + кнопки
    try { await ctx.api.deleteMessage(lyricsMsg.chat.id, lyricsMsg.message_id); } catch {}

    try {
      await ctx.reply(
        `📝 <b>Текст вашей песни:</b>\n\n${escapeHtml(aiResult.lyrics)}\n\n` +
        `Как вам?🤩\n\n` +
        `💎 Этот уникальный текст только ваш! И помните: какой бы он не был прекрасный - <u>это только 20%</u> от того чуда, что вас ждёт!\n\n` +
        `🔥 <b>Всю магию творит музыка!</b> Возьмите любой мировой хит и без музыки прочтите только текст - это будут самые обычные стихи 🤷\n\n` +
        `<i>Если нужно - вы можете внести свои коррективы, или добавить какие-то конкретные детали 🤗</i>`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('🔥 Создать песню с данным текстом', 'create_song').danger()
            .row()
            .text('📝 Изменить текст', 'edit_lyrics'),
        },
      );
      console.log('[telegram] lyrics shown to user with buttons');
      return; // IMPORTANT: stop here, wait for user to click button
    } catch (e) {
      console.error('[telegram] FAILED to show lyrics:', e.message);
      // Fallback — generate directly
      setState(PLATFORM, ctx.from.id, 'generating');
      await handleGenerate(ctx, { mode: 'custom', lyrics: aiResult.lyrics, tags: aiResult.tags, title: aiResult.title });
    }
  });

  // Создать песню → оплата
  bot.callbackQuery('create_song', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const session = getSession(PLATFORM, ctx.from.id);
    if (!session.data?.lyrics) {
      await ctx.reply('Сессия устарела. Нажмите /start чтобы начать заново 🎵');
      return;
    }

    if (!config.paywallEnabled || !config.robokassa.merchantId) {
      // Оплата выключена — генерируем бесплатно
      const { lyrics, tags, title } = session.data;
      setState(PLATFORM, ctx.from.id, 'generating');
      await handleGenerate(ctx, { mode: 'custom', lyrics, tags, title });
      return;
    }

    // Создаём счёт
    const invId = generateInvId(ctx.from.id);
    const { lyrics, tags, title } = session.data;
    const payUrl = createInvoiceUrl(invId, config.songPrice, `Песня — Подари Песню!`);

    setPayment(invId, {
      platform: PLATFORM,
      userId: ctx.from.id,
      lyrics, tags, title,
      amount: config.songPrice,
    });
    setState(PLATFORM, ctx.from.id, 'awaiting_payment', { invId });

    await ctx.reply(
      `💳 <b>Оплата создания песни</b>\n\n` +
      `Стоимость: <b>${config.songPrice} ₽</b>\n\n` +
      `После оплаты песня будет создана автоматически и отправлена вам в этот чат! 🎵\n\n` +
      `<i>Нажмите кнопку ниже для перехода к оплате:</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .url(`💳 Оплатить ${config.songPrice} ₽`, payUrl)
          .row()
          .text('✅ Я оплатил', 'check_payment')
          .row()
          .text('⬅️ Назад к тексту', 'back_to_lyrics'),
      },
    );
  });

  // Проверка оплаты вручную
  bot.callbackQuery('check_payment', async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = getSession(PLATFORM, ctx.from.id);
    const invId = session.data?.invId;
    if (!invId) {
      await ctx.answerCallbackQuery({ text: 'Сессия устарела, нажмите /start' });
      return;
    }
    const payment = getPayment(invId);
    if (payment && payment.status === 'paid') {
      try { await ctx.deleteMessage(); } catch {}
      setState(PLATFORM, ctx.from.id, 'generating');
      await handleGenerate(ctx, {
        mode: 'custom',
        lyrics: payment.lyrics,
        tags: payment.tags,
        title: payment.title,
      });
    } else {
      await ctx.answerCallbackQuery({ text: '⏳ Оплата ещё не поступила. Подождите немного.', show_alert: true });
    }
  });

  // Изменить текст
  bot.callbackQuery('edit_lyrics', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    setState(PLATFORM, ctx.from.id, 'editing_lyrics');
    await ctx.reply(
      '🤔 <b>Что вы хотели бы поменять?</b>\n\n' +
      'Нашли ошибку? Не нравится какое-то слово в припеве? Или нужно заменить строчку в куплете?\n\n' +
      '📝 Напишите текстом, или надиктуйте голосом 🎙 что конкретно нужно изменить, и мы учтём ваши пожелания! 👇',
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('⬅️ Назад к тексту песни', 'back_to_lyrics'),
      },
    );
  });

  // Назад к тексту
  bot.callbackQuery('back_to_lyrics', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    const session = getSession(PLATFORM, ctx.from.id);
    if (!session.data?.lyrics) {
      await ctx.reply('Сессия устарела. Нажмите /start чтобы начать заново 🎵');
      return;
    }
    const { lyrics } = session.data;
    setState(PLATFORM, ctx.from.id, 'review_lyrics');
    await ctx.reply(
      `📝 <b>Текст вашей песни:</b>\n\n${escapeHtml(lyrics)}\n\n` +
      `<i>Если нужно - вы можете внести свои коррективы 🤗</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard()
          .text('🔥 Создать песню с данным текстом', 'create_song').danger()
          .row()
          .text('📝 Изменить текст', 'edit_lyrics'),
      },
    );
  });

  // Правки пожеланий (из экрана подтверждения)
  bot.callbackQuery('edit_wishes', async (ctx) => {
    await ctx.answerCallbackQuery();
    try { await ctx.deleteMessage(); } catch {}
    setState(PLATFORM, ctx.from.id, 'awaiting_wishes');
    await ctx.reply('✏️ Напишите новые пожелания к песне, или надиктуйте голосом 🎙');
  });

  // Примеры пожеланий
  bot.callbackQuery('show_examples', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(EXAMPLES_TEXT, { parse_mode: 'HTML' });
  });

  // Текстовые сообщения
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text.trim();

    if (text.startsWith('/')) return;

    const session = getSession(PLATFORM, userId);

    if (session.state === 'awaiting_occasion_custom') {
      setState(PLATFORM, userId, 'awaiting_genre', { occasion: text });
      await ctx.reply('Вопрос 2/5. Выберите жанр для вашей песни☝️', {
        reply_markup: q2Keyboard(),
      });
      return;
    }

    if (session.state === 'awaiting_genre_custom') {
      setState(PLATFORM, userId, 'awaiting_mood', { genre: text });
      await ctx.reply(
        'Вопрос 3/5. Отлично! Теперь выберите настроение для вашей песни☝️',
        { reply_markup: q3Keyboard() },
      );
      return;
    }

    if (session.state === 'awaiting_wishes') {
      console.log('[telegram] awaiting_wishes → confirm, data:', JSON.stringify(session.data).substring(0, 200));
      setState(PLATFORM, userId, 'confirm', { wishes: text });
      const { occasion, genre, mood, voice } = session.data;
      await ctx.reply(
        '✅ <b>Отлично! Вот что получилось:</b>\n\n' +
          `🎉 Повод: ${occasion}\n` +
          `🎵 Жанр: ${genre}\n` +
          `🎭 Настроение: ${mood}\n` +
          `🎤 Голос: ${voice}\n` +
          `📝 Пожелания: ${escapeHtml(text.substring(0, 150))}${text.length > 150 ? '...' : ''}\n\n` +
          'Просто нажмите на кнопку 👇',
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('🔥 Создать текст песни', 'confirm_create').danger()
            .row()
            .text('✏️ Внести правки', 'edit_wishes'),
        },
      );
      return;
    }

    if (session.state === 'editing_lyrics') {
      // Пользователь прислал правки → AI переделывает текст
      const editMsg = await ctx.reply('✍️ Вношу правки…');
      const { occasion, genre, mood, voice, wishes, lyrics: oldLyrics } = session.data;
      try {
        const aiResult = await generateLyrics({
          occasion, genre, mood, voice,
          wishes: wishes + '\n\nПРАВКИ К ТЕКСТУ: ' + text + '\n\nПредыдущий текст:\n' + oldLyrics,
        });
        setState(PLATFORM, userId, 'review_lyrics', {
          lyrics: aiResult.lyrics,
          tags: aiResult.tags,
          title: aiResult.title,
        });
        try { await ctx.api.deleteMessage(editMsg.chat.id, editMsg.message_id); } catch {}
        await ctx.reply(
          `📝 <b>Обновлённый текст:</b>\n\n${escapeHtml(aiResult.lyrics)}\n\n` +
          `<i>Если нужно - вы можете внести ещё коррективы 🤗</i>`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('🔥 Создать песню с данным текстом', 'create_song').danger()
              .row()
              .text('📝 Изменить текст', 'edit_lyrics'),
          },
        );
      } catch (e) {
        console.error('[telegram] AI правки ошибка:', e.message);
        try { await ctx.api.deleteMessage(editMsg.chat.id, editMsg.message_id); } catch {}
        await ctx.reply('⚠️ Не удалось внести правки. Попробуйте ещё раз или нажмите "Создать песню".');
      }
      return;
    }

    if (session.state === 'review_lyrics') {
      await ctx.reply('👆 Используйте кнопки выше — "Создать песню" или "Изменить текст"');
      return;
    }

    if (session.state === 'awaiting_payment') {
      await ctx.reply('💳 Оплатите заказ по кнопке выше. После оплаты нажмите "Я оплатил" ✅');
      return;
    }

    if (session.state === 'generating') {
      await ctx.reply('🎧 Уже создаю вашу песню, подождите немного…');
      return;
    }

    await ctx.reply('Нажмите /start чтобы начать 🎵');
  });

  // Голосовые сообщения — пока заглушка, будет STT
  bot.on('message:voice', async (ctx) => {
    const session = getSession(PLATFORM, ctx.from.id);
    if (['awaiting_wishes', 'awaiting_occasion_custom', 'editing_lyrics'].includes(session.state)) {
      await ctx.reply('🎙 Голосовые сообщения скоро будут поддерживаться! Пока напишите текстом 📝');
    } else {
      await ctx.reply('Нажмите /start чтобы начать 🎵');
    }
  });

  // /cancel
  bot.command('cancel', async (ctx) => {
    resetSession(PLATFORM, ctx.from.id);
    await ctx.reply('Окей, отменил. Нажми /start чтобы начать заново 🎵');
  });

  // /ping
  bot.command('ping', async (ctx) => {
    const ok = await pingSuno();
    const credits = ok ? await getCreditsLeft() : null;
    await ctx.reply(
      ok
        ? `✅ Студия на связи${credits != null ? `\n💎 Кредитов осталось: ${credits}` : ''}`
        : '❌ Студия пока недоступна.',
    );
  });

  bot.catch((err) => {
    console.error('[telegram] ERROR:', err.message || err);
    if (err.error) console.error('[telegram] cause:', err.error);
  });

  // Экспортируем метод для webhook — авто-генерация после оплаты
  bot._handlePaidGeneration = async (payment) => {
    const { userId, lyrics, tags, title } = payment;
    setState(PLATFORM, userId, 'generating');
    try {
      const ctx = { from: { id: userId } };
      // Мотивационное сообщение
      await bot.api.sendMessage(userId,
        '🥺 Не каждый подарок умеет говорить "я рядом"…\n\n' +
        'Но <b>песня</b> — умеет.\n\n🎵 Создаём вашу персональную песню!',
        { parse_mode: 'HTML' });

      const progressMsg = await bot.api.sendMessage(userId,
        'Начали сочинять вашу песню\n' + heartProgress(10));

      let lastPercent = 10;
      const editProgress = async (label, percent) => {
        if (percent === lastPercent) return;
        lastPercent = percent;
        try {
          await bot.api.editMessageText(userId, progressMsg.message_id,
            `${label}\n${heartProgress(percent)}`);
        } catch {}
      };

      const onStatus = async (raw) => {
        const s = (raw || '').toLowerCase();
        if (s.includes('queued') || s.includes('submitted')) await editProgress('Начали сочинять', 20);
        else if (s.includes('generating') || s.includes('streaming')) await editProgress('Превращаем в хит', 55);
        else if (s.includes('complete')) await editProgress('Финальные штрихи', 90);
      };

      const result = await runGeneration({ mode: 'custom', lyrics, tags, title, onStatus });
      resetSession(PLATFORM, userId);

      if (!result.ok) {
        await bot.api.editMessageText(userId, progressMsg.message_id,
          '😔 Не получилось создать песню. Попробуйте ещё раз — /start');
        return;
      }

      await bot.api.editMessageText(userId, progressMsg.message_id,
        '🎉 Ваша песня готова!\n' + heartProgress(100));

      for (const clip of result.clips) {
        const caption = (clip.title ? `🎵 ${clip.title}\n\n` : '🎵 Ваша персональная песня!\n\n') +
          'Хотите ещё одну? /start';
        try {
          await bot.api.sendAudio(userId, clip.audioUrl, { caption });
        } catch {
          await bot.api.sendMessage(userId, `🎵 ${clip.title || 'Ваш трек'}\n${clip.audioUrl}\n\nХотите ещё? /start`);
        }
      }
    } catch (e) {
      console.error('[telegram] paid generation error:', e.message);
      resetSession(PLATFORM, userId);
      await bot.api.sendMessage(userId, '😔 Произошла ошибка. Попробуйте /start').catch(() => {});
    }
  };

  return bot;
}

async function handleGenerate(ctx, opts) {
  console.log('[telegram] handleGenerate called, mode:', opts.mode, 'has lyrics:', !!opts.lyrics);
  // Мотивационное сообщение
  await ctx.reply(
    '🥺 Не каждый подарок умеет говорить "я рядом"…\n\n' +
      'Но <b>песня</b> — умеет. Наши клиенты говорят, что она передаёт всё то, что сложно сказать в обычном разговоре: благодарность, поддержку, общие воспоминания.\n\n' +
      '🎵 Создаём вашу персональную песню!',
    { parse_mode: 'HTML' },
  );

  // Сообщение прогресса (будем редактировать)
  const progressMsg = await ctx.reply('Начали сочинять вашу песню\n' + heartProgress(10));

  let lastPercent = 10;
  const editProgress = async (label, percent) => {
    if (percent === lastPercent) return;
    lastPercent = percent;
    try {
      await ctx.api.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        `${label}\n${heartProgress(percent)}`,
      );
    } catch {
      // "message is not modified" — игнорируем
    }
  };

  const onStatus = async (raw) => {
    const s = (raw || '').toLowerCase();
    if (s.includes('queued') || s.includes('submitted')) {
      await editProgress('Начали сочинять вашу песню', 20);
    } else if (s.includes('generating') || s.includes('streaming')) {
      await editProgress('Превращаем вашу историю в хит', 55);
    } else if (s.includes('complete')) {
      await editProgress('Финальные штрихи', 90);
    }
  };

  const result = await runGeneration({ ...opts, onStatus });
  resetSession(PLATFORM, ctx.from.id);

  if (!result.ok) {
    try {
      await ctx.api.editMessageText(
        progressMsg.chat.id,
        progressMsg.message_id,
        '😔 Не получилось создать песню. Попробуйте ещё раз — /start',
      );
    } catch {
      await ctx.reply('😔 Не получилось создать песню. Попробуйте ещё раз — /start');
    }
    return;
  }

  try {
    await ctx.api.editMessageText(
      progressMsg.chat.id,
      progressMsg.message_id,
      '🎉 Ваша песня готова!\n' + heartProgress(100),
    );
  } catch { /* ignore */ }

  for (const clip of result.clips) {
    const caption = (clip.title ? `🎵 ${clip.title}\n\n` : '🎵 Ваша персональная песня!\n\n') +
      'Хотите ещё одну? /start';
    try {
      await ctx.replyWithAudio(clip.audioUrl, { caption });
    } catch {
      await ctx.reply(`🎵 ${clip.title || 'Ваш трек'}\n${clip.audioUrl}\n\nХотите ещё? /start`);
    }
  }
}
