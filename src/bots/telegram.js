import { Bot, InlineKeyboard } from 'grammy';
import { config, assertBotConfig } from '../config.js';
import { getSession, setState, resetSession } from '../store.js';
import { runGeneration } from '../flow/generate.js';
import { pingSuno, getCreditsLeft } from '../suno/client.js';

const PLATFORM = 'tg';

const WELCOME =
  '🏛 Добро пожаловать в *сервис №1* по созданию персональных песен на заказ — *Подари Трек*\n\n' +
  '🎤 Создайте песню за 5 минут по любой вашей истории, которая станет незабываемым *ВАУ-подарком* для вас и ваших близких❤️\n\n' +
  '🎬 А также под песни мы делаем волшебные анимированные *видео-мультфильмы из ваших фотографий*✨\n\n' +
  '❌ Вам не нужно петь\n' +
  '❌ Не нужно придумывать слова\n\n' +
  '✅ Ответьте на 5 простых вопросов и получите уникальный текст к вашей песне совершенно бесплатно уже через 3 минуты!\n\n' +
  '📝 Если понравится текст — вы сразу сможете *превратить его в настоящую песню!*\n\n' +
  '😁 За 11 лет работы мы подарили более 500.000+ клиентам самые незабываемые эмоции с помощью песен! Удивим и вас🔥\n\n' +
  '— Ну что? Начнем? 🥹';

const WISHES_PROMPT =
  '🎤 *Последний шаг к созданию вашей песни!*\n\n' +
  'Напишите всего несколько фактов о получателе❤️\n\n' +
  '✏️ Имя получателя песни и кем он вам приходится\n' +
  '🥰 Какие эмоции хотите передать (любовь, благодарность, юмор и т.д.)\n' +
  '🤔 То, что знаете только вы: забавные случаи, любимые фразы\n' +
  '🌟 Что делает его особенным: привычки, за что вы его любите, как по-своему называете\n\n' +
  '⚠️ _Самое главное: Не усложняйте! Хватит несколько простых фактов!_\n\n' +
  '📝 Напишите текстом, или надиктуйте голосом 🎙 свои пожелания к песне в ответ на это сообщение☝️';

const EXAMPLES_TEXT =
  'Пример 1.\n\n' +
  '🥰 *Мужу Диме на день рождения*\n\n' +
  'Вместе 21 год. Знакомы со школы, Дима покорил меня песней на гитаре) Зову его "радость моя", а он меня "кОтя". Сын Даня и дочка Анжелика. Даня поступил в университет в Питере. Анжелика обожает ездить на рыбалку с папой. Мы его очень сильно любим!\n\n' +
  'Пример 2.\n\n' +
  '🤲 *Для жены Ольги на юбилей*\n\n' +
  'Познакомились с Оленькой на работе, она повар. Первое свидание в кино, в 2013 поженились. В 2015 родилась дочь Алёна, наша звёздочка! Оля обожает цветы и кота рыжика. Люблю их с дочкой и буду всегда для них опорой.\n\n' +
  'Пример 3.\n\n' +
  '💃 *Для подруги Лизы*\n\n' +
  'Она светит как солнце! Обожает своего кота Васю и кофе с корицей. Любимая фраза «Сама решу»)) Хочу, чтобы песня была тёплой, как наши вечерние разговоры. Повод — её день рождения 🎂\n\n' +
  '📝 _Напишите текстом свои пожелания к песне в ответ на это сообщение☝️_';

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
    .text('💃 Танцевальная музыка', 'q2:танцевальный, электронный');
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
    .text('🎙 Мужским', 'q4:мужской вокал')
    .text('🎤 Женским', 'q4:женский вокал');
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
    await ctx.reply(WELCOME, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('🎤 Создать свою песню', 'create'),
    });
  });

  // Кнопка "Создать свою песню" → Вопрос 1/5
  bot.callbackQuery('create', async (ctx) => {
    await ctx.answerCallbackQuery();
    setState(PLATFORM, ctx.from.id, 'awaiting_occasion');
    await ctx.reply(
      'Вопрос 1/5. На какое событие вы хотите подарить песню?\n\n' +
        '_Можете выбрать из списка, или написать свой вариант☝️_',
      { parse_mode: 'Markdown', reply_markup: q1Keyboard() },
    );
  });

  // Вопрос 1 — событие
  bot.callbackQuery(/^q1:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const val = ctx.match[1];
    if (val === 'custom') {
      setState(PLATFORM, ctx.from.id, 'awaiting_occasion_custom');
      await ctx.reply('✏️ Напишите свой вариант события:');
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
    setState(PLATFORM, ctx.from.id, 'awaiting_mood', { genre: ctx.match[1] });
    await ctx.reply(
      'Вопрос 3/5. Отлично! Теперь выберите настроение для вашей песни☝️',
      { reply_markup: q3Keyboard() },
    );
  });

  // Вопрос 3 — настроение
  bot.callbackQuery(/^q3:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    setState(PLATFORM, ctx.from.id, 'awaiting_voice', { mood: ctx.match[1] });
    await ctx.reply('Вопрос 4/5. Каким голосом будем исполнять вашу песню☝️', {
      reply_markup: q4Keyboard(),
    });
  });

  // Вопрос 4 — голос
  bot.callbackQuery(/^q4:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    setState(PLATFORM, ctx.from.id, 'awaiting_wishes', { voice: ctx.match[1] });
    await ctx.reply(WISHES_PROMPT, {
      parse_mode: 'Markdown',
      reply_markup: wishesKeyboard(),
    });
  });

  // Примеры пожеланий
  bot.callbackQuery('show_examples', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(EXAMPLES_TEXT, { parse_mode: 'Markdown' });
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

    if (session.state === 'awaiting_wishes') {
      const { occasion, genre, mood, voice } = session.data;
      setState(PLATFORM, userId, 'generating');
      await handleGenerate(ctx, {
        mode: 'description',
        prompt: buildPrompt({ occasion, genre, mood, voice, wishes: text }),
      });
      return;
    }

    if (session.state === 'generating') {
      await ctx.reply('🎧 Уже создаю вашу песню, подождите немного…');
      return;
    }

    await ctx.reply('Нажмите /start чтобы начать 🎵');
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

  bot.catch((err) => console.error('[telegram]', err));

  return bot;
}

async function handleGenerate(ctx, opts) {
  // Мотивационное сообщение
  await ctx.reply(
    '🥺 Не каждый подарок умеет говорить "я рядом"…\n\n' +
      'Но *песня* — умеет. Наши клиенты говорят, что она передаёт всё то, что сложно сказать в обычном разговоре: благодарность, поддержку, общие воспоминания.\n\n' +
      '🎵 Создаём вашу персональную песню!',
    { parse_mode: 'Markdown' },
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
        `😔 Не получилось создать песню: ${result.error}\n\nПопробуйте ещё раз — /start`,
      );
    } catch {
      await ctx.reply(`😔 Не получилось: ${result.error}\n\nПопробуйте ещё раз — /start`);
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
