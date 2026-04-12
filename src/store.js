// Очень простой in-memory store состояния пользователя.
// Для прод-версии заменить на Redis / SQLite.

const sessions = new Map(); // key: `${platform}:${userId}` -> { state, data }
const payments = new Map(); // key: invId -> { platform, userId, status, lyrics, tags, title, ... }

const DEFAULT = () => ({ state: 'idle', data: {} });

function key(platform, userId) {
  return `${platform}:${userId}`;
}

export function getSession(platform, userId) {
  const k = key(platform, userId);
  if (!sessions.has(k)) sessions.set(k, DEFAULT());
  return sessions.get(k);
}

export function setState(platform, userId, state, patch = {}) {
  const s = getSession(platform, userId);
  s.state = state;
  s.data = { ...s.data, ...patch };
  return s;
}

export function resetSession(platform, userId) {
  sessions.set(key(platform, userId), DEFAULT());
}

// --- Payments ---

export function setPayment(invId, data) {
  payments.set(String(invId), { status: 'pending', createdAt: Date.now(), ...data });
}

export function getPayment(invId) {
  return payments.get(String(invId)) || null;
}

export function setPaymentStatus(invId, status) {
  const p = payments.get(String(invId));
  if (p) p.status = status;
}

export function findPaymentByUser(platform, userId) {
  for (const [invId, p] of payments) {
    if (p.platform === platform && p.userId === userId && p.status === 'pending') {
      return { invId, ...p };
    }
  }
  return null;
}

// Состояния:
//  idle          - ничего не ждём
//  awaiting_mode - ждём выбор "описание" vs "свои стихи"
//  awaiting_prompt     - ждём текстовое описание (description mode)
//  awaiting_lyrics     - ждём кастомные стихи (custom mode)
//  awaiting_style      - ждём жанр/стиль (custom mode)
//  awaiting_title      - ждём название (custom mode)
//  generating    - задание отправлено, ждём результат
