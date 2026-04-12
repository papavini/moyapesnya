import { createHash } from 'crypto';
import { config } from '../config.js';

function md5(str) {
  return createHash('md5').update(str).digest('hex');
}

/**
 * Генерирует URL для оплаты через Robokassa.
 * @param {number} invId — номер заказа (уникальный)
 * @param {number} amount — сумма в рублях
 * @param {string} description — описание заказа
 * @returns {string} URL для перенаправления пользователя
 */
export function createInvoiceUrl(invId, amount, description) {
  const { merchantId, pass1, testMode } = config.robokassa;
  const sum = amount.toFixed(2);

  // Подпись: MD5(MerchantId:Sum:InvId:Password1)
  const signature = md5(`${merchantId}:${sum}:${invId}:${pass1}`);

  const base = testMode
    ? 'https://auth.robokassa.ru/Merchant/Index.aspx'
    : 'https://auth.robokassa.ru/Merchant/Index.aspx';

  const params = new URLSearchParams({
    MerchantLogin: merchantId,
    OutSum: sum,
    InvId: String(invId),
    Description: description,
    SignatureValue: signature,
    IsTest: testMode ? '1' : '0',
    Culture: 'ru',
  });

  return `${base}?${params.toString()}`;
}

/**
 * Проверяет подпись от Robokassa (Result URL callback).
 * Формула: MD5(OutSum:InvId:Password2)
 * @param {object} params — параметры из запроса { OutSum, InvId, SignatureValue }
 * @returns {boolean}
 */
export function verifyResult(params) {
  const { pass2 } = config.robokassa;
  const { OutSum, InvId, SignatureValue } = params;
  const expected = md5(`${OutSum}:${InvId}:${pass2}`);
  return expected.toLowerCase() === (SignatureValue || '').toLowerCase();
}

/**
 * Генерирует уникальный InvId на основе timestamp + userId.
 */
let invCounter = 0;
export function generateInvId(userId) {
  invCounter++;
  return Number(`${Date.now() % 1000000}${invCounter}`);
}
