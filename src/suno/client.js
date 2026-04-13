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
  try {
    const resp = await post('/api/generate', {
      prompt,
      make_instrumental: instrumental,
      wait_audio: false,
    });
    return normalizeClipsResponse(resp);
  } catch (e) {
    if (e.status === 422 || (e.message && e.message.includes('Token'))) {
      console.log('[suno] token expired, refreshing via CDP...');
      try {
        const { refreshPasskeyToken } = await import('./refresh-passkey.js');
        await refreshPasskeyToken();
      } catch (re) {
        console.log('[suno] refresh failed:', re.message);
      }
      // Wait for suno-api to fully restart after token refresh
      await new Promise(r => setTimeout(r, 8000));
      const resp = await post('/api/generate', {
        prompt,
        make_instrumental: instrumental,
        wait_audio: false,
      });
      return normalizeClipsResponse(resp);
    }
    throw e;
  }
}

export async function generateCustom({ lyrics, tags, title, instrumental = false }) {
  try {
    const resp = await post('/api/custom_generate', {
      prompt: lyrics,
      tags,
      title,
      make_instrumental: instrumental,
      wait_audio: false,
    });
    return normalizeClipsResponse(resp);
  } catch (e) {
    // If token expired, refresh and retry once
    if (e.status === 422 || (e.message && e.message.includes('Token'))) {
      console.log('[suno] token expired, refreshing via CDP...');
      try {
        const { refreshPasskeyToken } = await import('./refresh-passkey.js');
        await refreshPasskeyToken();
      } catch (re) {
        console.log('[suno] refresh failed:', re.message);
      }
      // Wait for suno-api to fully restart after token refresh
      await new Promise(r => setTimeout(r, 8000));
      // Retry
      const resp = await post('/api/custom_generate', {
        prompt: lyrics,
        tags,
        title,
        make_instrumental: instrumental,
        wait_audio: false,
      });
      return normalizeClipsResponse(resp);
    }
    throw e;
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
    const clips = await getClips(ids);
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
 * Проверяет что токен жив и обновляет passkey перед генерацией.
 */
export async function ensureTokenAlive() {
  // 1. Check API is reachable
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${config.suno.base}/api/get_limit`);
      if (res.ok) break;
      console.log(`[suno] проверка попытка ${attempt}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`[suno] проверка попытка ${attempt}: ${e.message}`);
      if (attempt === 3) return false;
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
  }

  return true;
}

export { SunoError };
