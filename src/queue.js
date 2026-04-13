/**
 * Простая серийная очередь генерации.
 * Все запросы выполняются по одному — нет параллельных генераций к SUNO.
 * Это предотвращает race condition на P1_ токен и перегрузку suno-api.
 */

const jobs = []; // { fn, resolve, reject }
let running = false;

/**
 * Количество jobs, ожидающих в очереди (не считая текущего в работе).
 */
export function getQueueLength() {
  return jobs.length;
}

/**
 * True если прямо сейчас идёт генерация.
 */
export function isGenerating() {
  return running;
}

/**
 * Позиция нового пользователя в очереди (1 = следующий, 0 = сейчас).
 * Вызывать ДО enqueue чтобы показать сообщение.
 */
export function getNextPosition() {
  return jobs.length + (running ? 1 : 0);
}

/**
 * Добавляет fn в очередь, возвращает Promise с результатом когда дойдёт очередь.
 */
export function enqueue(fn) {
  return new Promise((resolve, reject) => {
    jobs.push({ fn, resolve, reject });
    tick();
  });
}

async function tick() {
  if (running || jobs.length === 0) return;
  running = true;
  const { fn, resolve, reject } = jobs.shift();
  try {
    resolve(await fn());
  } catch (e) {
    reject(e);
  } finally {
    running = false;
    tick(); // запускаем следующего
  }
}
