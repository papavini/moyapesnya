// Общая логика генерации, не зависящая от TG/VK.
// Платформенный код вызывает runGeneration(ctx) и получает структурированный результат,
// а сам решает как это показать пользователю.

import {
  generateByDescription,
  generateCustom,
  waitForClips,
  ensureTokenAlive,
} from '../suno/client.js';
import { config } from '../config.js';

/**
 * @param {object} opts
 * @param {'description'|'custom'} opts.mode
 * @param {string} [opts.prompt]      - description mode: текст для SUNO
 * @param {string} [opts.lyrics]      - custom mode: тексты песни
 * @param {string} [opts.tags]        - custom mode: жанр/стиль (через запятую)
 * @param {string} [opts.title]       - custom mode: название
 * @param {boolean} [opts.instrumental]
 * @param {(msg: string) => Promise<void>|void} [opts.onStatus] - колбэк для "песня готовится..."
 */
export async function runGeneration(opts) {
  const status = opts.onStatus ?? (() => {});

  await status('Проверяю готовность студии…');

  const alive = await ensureTokenAlive();
  if (!alive) {
    return {
      ok: false,
      error: 'Сессия SUNO истекла. Попробуйте через минуту или обратитесь к администратору.',
    };
  }

  await status('Отправляю задание в SUNO…');

  let initial;
  try {
    if (opts.mode === 'custom') {
      initial = await generateCustom({
        lyrics: opts.lyrics || '',
        tags: opts.tags || '',
        title: opts.title || '',
        instrumental: !!opts.instrumental,
      });
    } else {
      initial = await generateByDescription(opts.prompt || '', {
        instrumental: !!opts.instrumental,
      });
    }
  } catch (e) {
    return {
      ok: false,
      error: `Не смог поставить задачу в SUNO: ${e.message}`,
      cause: e,
    };
  }

  if (!initial.length) {
    return { ok: false, error: 'SUNO не вернул ни одного клипа на старте.' };
  }

  const ids = initial.map((c) => c.id).filter(Boolean);
  await status(`SUNO принял задание (${ids.length} клип${ids.length === 1 ? '' : 'а'}). Жду готовности…`);

  let lastStatuses = '';
  const { clips, done, failed, timedOut } = await waitForClips(ids, {
    onProgress: async (cs) => {
      const cur = cs.map((c) => c.status).join(',');
      if (cur && cur !== lastStatuses) {
        lastStatuses = cur;
        await status(`Статусы клипов: ${cur}`);
      }
    },
  });

  if (done.length === 0) {
    return {
      ok: false,
      error: timedOut
        ? 'SUNO не успел сгенерировать трек за отведённое время.'
        : 'SUNO вернул ошибку по всем клипам.',
      clips,
      failed,
    };
  }

  const toSend = config.suno.sendFirstOnly ? done.slice(0, 1) : done;
  return { ok: true, clips: toSend, allClips: clips };
}
