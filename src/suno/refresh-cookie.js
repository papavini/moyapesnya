/**
 * Обновляет SUNO_COOKIE через CDP (RDP Chromium port 9223).
 *
 * Алгоритм:
 * 1. Подключаемся к RDP Chromium (порт 9223, реальная сессия)
 * 2. Вызываем Network.getAllCookies — получаем ВСЕ куки включая httpOnly __client
 * 3. Фильтруем куки для suno.com
 * 4. Записываем в ~/projects/suno_cookie.txt
 * 5. Перезапускаем suno-api через sudo systemctl restart suno-api
 *
 * __client — Clerk httpOnly cookie, НЕ виден через document.cookie.
 * Только Network.getAllCookies (CDP) возвращает его.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223;
const COOKIE_FILE = path.join(homedir(), 'projects', 'suno_cookie.txt');

export async function refreshCookie() {
  const { default: WebSocket } = await import('ws');
  const { default: http } = await import('http');

  console.log('[cookie] подключаемся к RDP Chromium CDP:', CDP_PORT);

  // Получаем список вкладок
  const tabs = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });

  // Берём любую вкладку — куки глобальные для профиля
  const tab = tabs.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!tab) throw new Error('[cookie] нет доступных вкладок в CDP');

  console.log('[cookie] вкладка:', tab.url);

  // Получаем куки через CDP
  const cookies = await new Promise((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let resolved = false;

    ws.on('error', reject);

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === 1) {
        resolved = true;
        ws.close();
        resolve(msg.result?.cookies || []);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        ws.close();
        reject(new Error('[cookie] таймаут CDP'));
      }
    }, 10000);
  });

  // Фильтруем куки для suno.com
  const sunoCookies = cookies.filter(c =>
    c.domain && (c.domain.includes('suno.com') || c.domain.includes('suno.ai'))
  );

  console.log('[cookie] найдено suno.com куки:', sunoCookies.length);

  const hasClient = sunoCookies.some(c => c.name === '__client');
  if (!hasClient) {
    throw new Error('[cookie] __client кука не найдена — Chromium не авторизован в SUNO');
  }

  // Формируем строку куки в формате HTTP Cookie header
  const cookieStr = sunoCookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Записываем в файл
  writeFileSync(COOKIE_FILE, cookieStr, 'utf8');
  console.log('[cookie] записано в', COOKIE_FILE, `(${cookieStr.length} chars)`);

  // Перезапускаем suno-api
  console.log('[cookie] перезапускаем suno-api...');
  execSync('sudo systemctl restart suno-api', { timeout: 15000 });

  // Ждём пока suno-api поднимется
  console.log('[cookie] ждём старта suno-api...');
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await fetch('http://localhost:3000/api/get_limit');
      if (res.ok) {
        console.log('[cookie] suno-api запущен ✅');
        return true;
      }
    } catch {}
  }

  throw new Error('[cookie] suno-api не поднялся за 30 сек после перезапуска');
}
