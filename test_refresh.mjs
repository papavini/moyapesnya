/**
 * Тест нового refresh-passkey.js — запускает CDP polling вручную.
 * Кликает Create на suno.com, ждёт P1_ токен, отправляет на passkey-server.
 */
import { refreshPasskeyToken } from '/home/alexander/projects/moyapesnya/src/suno/refresh-passkey.js';

console.log('[test] Запускаю passkey refresh...');
const result = await refreshPasskeyToken();
console.log('[test] Результат:', result);
process.exit(result ? 0 : 1);
