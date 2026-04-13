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
      error: 'Сервер временно недоступен. Попробуйте через минуту.',
    };
  }

  await status('Отправляю задание в студию…');

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
    console.error('[generate] ошибка генерации:', e.message, e.body ? JSON.stringify(e.body).substring(0, 200) : '');
    return {
      ok: false,
      error: 'Ошибка при отправке в студию. Попробуйте ещё раз.',
      cause: e,
    };
  }

  if (!initial.length) {
    return { ok: false, error: 'Студия не приняла задание. Попробуйте ещё раз.' };
  }

  const ids = initial.map((c) => c.id).filter(Boolean);
  await status(`Студия приняла задание. Ожидаем готовности…`);

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
        ? 'Студия не успела сгенерировать трек за отведённое время. Попробуйте ещё раз.'
        : 'Произошла ошибка при создании песни. Попробуйте ещё раз.',
      clips,
      failed,
    };
  }

  const toSend = config.suno.sendFirstOnly ? done.slice(0, 1) : done;
  return { ok: true, clips: toSend, allClips: clips };
}
