/**
 * Коды доступа для закрытого бета-теста.
 * Каждый 6-значный код привязывается к одному Telegram userId.
 * После привязки код не может использоваться другим пользователем.
 * Повторный /start от того же пользователя — пропускает проверку.
 *
 * In-memory: сбрасывается при рестарте бота.
 * Для прод-версии — перенести в SQLite/Redis.
 */

// code -> null (свободен) | number (telegram userId кто активировал)
const CODES = {
  '482916': null,
  '735024': null,
  '619483': null,
  '284750': null,
  '931672': null,
  '507839': null,
  '164295': null,
  '849017': null,
  '372540': null,
  '658193': null,
  '193748': null,
  '427685': null,
  '816034': null,
  '295471': null,
  '740362': null,
  '583901': null,
  '162847': null,
  '904738': null,
  '371205': null,
  '648592': null,
};

/**
 * Проверяет код и привязывает к userId.
 * @returns {'ok' | 'invalid' | 'used'}
 */
export function checkAndUseCode(code, userId) {
  const c = String(code).trim();
  if (!(c in CODES)) return 'invalid';
  const usedBy = CODES[c];
  if (usedBy === null) {
    CODES[c] = userId;
    console.log(`[access] код ${c} активирован пользователем ${userId}`);
    return 'ok';
  }
  if (usedBy === userId) return 'ok'; // уже активировал ранее
  return 'used'; // код занят другим
}

/**
 * Проверяет, прошёл ли пользователь активацию (есть хотя бы один привязанный код).
 */
export function isUserVerified(userId) {
  return Object.values(CODES).includes(userId);
}

/**
 * Список кодов с их статусом — для администратора (/codes).
 */
export function getCodesStatus() {
  return Object.entries(CODES).map(([code, uid]) => ({
    code,
    used: uid !== null,
    userId: uid,
  }));
}
