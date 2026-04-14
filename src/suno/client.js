// Клиент к self-hosted gcui-art/suno-api.
// Репозиторий: https://github.com/gcui-art/suno-api
// Ожидаемые эндпоинты (проверь README suno-api — они меняются от версии):
//   POST /api/generate            { prompt, make_instrumental?, wait_audio? }
//   POST /api/custom_generate     { prompt, tags, title, make_instrumental? }
//   GET  /api/get?ids=<id1,id2>   -> [{ id, status, audio_url, video_url, ... }]
//   GET  /api/get_limit           -> { credits_left, ... }
//
// Мы НЕ используем wait_audio:true чтобы не висеть в одном HTTP-запросе:
// делаем generate -> потом опрашиваем /api/get пока status не станет "complete".

import { fetch } from 'undici';
import { config } from '../config.js';

function isTokenError(e) {
  return e.status === 422 || (e.message && e.message.includes('Token'));
}

function isSessionError(e) {
  const body = typeof e.body === 'object' ? JSON.stringify(e.body) : String(e.body || '');
  return e.status === 500 && (body.includes('session id') || body.includes('SUNO_COOKIE'));
}

async function handleSunoError(e, fills) {
  if (isSessionError(e)) {
    console.log('[suno] cookie expired, refreshing via CDP...');
    const { refreshCookie } = await import('./refresh-cookie.js');
    await refreshCookie();
    return 'cookie';
  }
  if (isTokenError(e)) {
    console.log('[suno] P1_ token expired, refreshing via CDP with user data...');
    const { refreshPasskeyToken } = await import('./refresh-passkey.js');
    await refreshPasskeyToken(fills); // передаём данные пользователя — не создаём мусор
    await new Promise(r => setTimeout(r, 8000));
    return 'token';
  }
  return null;
}

class SunoError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'SunoError';
    this.status = status;
    this.body = body;
  }
}

async function post(path, payload) {
  const url = `${config.suno.base}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new SunoError(`SUNO ${path} вернул ${res.status}`, { status: res.status, body: json });
  }
  return json;
}

async function get(path) {
  const url = `${config.suno.base}${path}`;
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new SunoError(`SUNO ${path} вернул ${res.status}`, { status: res.status, body: json });
  }
  return json;
}

export async function generateByDescription(prompt, { instrumental = false } = {}) {
  const payload = { prompt, make_instrumental: instrumental, wait_audio: false };
  try {
    return normalizeClipsResponse(await post('/api/generate', payload));
  } catch (e) {
    if (!await handleSunoError(e)) throw e;
    try {
      return normalizeClipsResponse(await post('/api/generate', payload));
    } catch (e2) {
      if (!await handleSunoError(e2)) throw e2;
      return normalizeClipsResponse(await post('/api/generate', payload));
    }
  }
}

export async function generateCustom({ lyrics, tags, title, instrumental = false }) {
  const payload = { prompt: lyrics, tags, title, make_instrumental: instrumental, wait_audio: false };
  const fills = [lyrics || '', tags || '', title || ''];
  try {
    return normalizeClipsResponse(await post('/api/custom_generate', payload));
  } catch (e) {
    // Первая ошибка: 500→cookie или 422→passkey
    if (!await handleSunoError(e, fills)) throw e;
    // Первый retry — может получить вторичную ошибку (напр. 500→cookie→422)
    try {
      return normalizeClipsResponse(await post('/api/custom_generate', payload));
    } catch (e2) {
      // Вторичная ошибка после первого fix: обрабатываем снова
      if (!await handleSunoError(e2, fills)) throw e2;
      // Финальный retry
      return normalizeClipsResponse(await post('/api/custom_generate', payload));
    }
  }
}

export async function getClips(ids) {
  if (!ids?.length) return [];
  const resp = await get(`/api/get?ids=${encodeURIComponent(ids.join(','))}`);
  return normalizeClipsResponse(resp);
}

export async function getCreditsLeft() {
  try {
    const resp = await get('/api/get_limit');
    // разные форки отдают по-разному
    return resp?.credits_left ?? resp?.remaining ?? null;
  } catch {
    return null;
  }
}

function normalizeClipsResponse(resp) {
  // suno-api может отдавать массив или { clips: [...] }
  const arr = Array.isArray(resp) ? resp : (resp?.clips ?? []);
  return arr.map((c) => ({
    id: c.id,
    status: c.status,
    audioUrl: c.audio_url || null,
    videoUrl: c.video_url || null,
    imageUrl: c.image_url || null,
    title: c.title || '',
  }));
}

/**
 * Ждём пока хотя бы один клип станет complete (или все failed).
 * onProgress(clips) вызывается на каждом тике.
 */
export async function waitForClips(ids, { onProgress } = {}) {
  const deadline = Date.now() + config.suno.pollTimeoutSec * 1000;
  const intervalMs = config.suno.pollIntervalSec * 1000;

  while (Date.now() < deadline) {
    let clips;
    try {
      clips = await getClips(ids);
    } catch (e) {
      // suno-api мог перезапуститься — ждём и повторяем, клипы на стороне SUNO живы
      console.log('[suno] waitForClips poll error:', e.message, '— retrying...');
      await new Promise((r) => setTimeout(r, intervalMs * 2));
      continue;
    }
    if (onProgress) onProgress(clips);

    // Только complete — это финальный трек на cdn1.suno.ai/.mp3 (2-3 минуты).
    // streaming = превью-огрызок ~30 сек на audiopipe.suno.ai, не считаем готовым.
    const done = clips.filter((c) => c.status === 'complete' && c.audioUrl);
    const failed = clips.filter((c) => c.status === 'error' || c.status === 'failed');

    if (done.length + failed.length === clips.length && clips.length > 0) {
      return { clips, done, failed, timedOut: false };
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const clips = await getClips(ids).catch(() => []);
  return {
    clips,
    done: clips.filter((c) => c.status === 'complete' && c.audioUrl),
    failed: clips.filter((c) => c.status === 'error' || c.status === 'failed'),
    timedOut: true,
  };
}

export async function pingSuno() {
  try {
    const res = await fetch(`${config.suno.base}/api/get_limit`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Проверяет что suno-api жив и cookie валидна. При 500 — обновляет cookie.
 * Возвращает false только если после refresh всё ещё недоступно (Clerk session expired).
 */
export async function ensureTokenAlive() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${config.suno.base}/api/get_limit`);
      if (res.ok) return true;
      console.log(`[suno] проверка попытка ${attempt}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`[suno] проверка попытка ${attempt}: ${e.message}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }

  // Все 3 попытки провалились — обновляем cookie
  console.log('[suno] suno-api недоступен, обновляем cookie...');
  try {
    const { refreshCookie } = await import('./refresh-cookie.js');
    await refreshCookie();
    await new Promise(r => setTimeout(r, 2000));
    const res = await fetch(`${config.suno.base}/api/get_limit`);
    if (res.ok) return true;
    console.log('[suno] после refresh всё ещё недоступен — Clerk сессия истекла?');
  } catch (e) {
    console.log('[suno] ошибка cookie refresh в ensureTokenAlive:', e.message);
  }

  return false;
}

export { SunoError };
