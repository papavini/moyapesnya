import { fetch } from 'undici';
import { config } from '../config.js';

const SYSTEM_PROMPT = `Ты — профессиональный автор песен на русском языке. Твоя задача — написать текст песни по запросу.

ПРАВИЛА:
- Пиши ТОЛЬКО текст песни, без пояснений и комментариев
- Используй структуру: [Куплет 1], [Припев], [Куплет 2], [Припев], [Бридж], [Припев]
- Упоминай имена и личные детали из пожеланий
- Текст должен быть трогательным, искренним, на живом разговорном русском
- Длина: 3-4 куплета + припев + бридж (итого ~200-300 слов)
- НЕ добавляй ремарки типа "(мелодия замедляется)" или описания музыки
- Каждый куплет и припев обозначай тегом в квадратных скобках`;

/**
 * Генерирует текст песни через OpenRouter (Gemini Flash Lite).
 * @param {object} params
 * @param {string} params.occasion — повод
 * @param {string} params.genre — жанр
 * @param {string} params.mood — настроение
 * @param {string} params.voice — голос
 * @param {string} params.wishes — пожелания пользователя
 * @returns {Promise<{lyrics: string, tags: string, title: string}>}
 */
export async function generateLyrics({ occasion, genre, mood, voice, wishes }) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const userPrompt =
    `Напиши песню на русском языке.\n` +
    `Повод: ${occasion}\n` +
    `Жанр: ${genre}\n` +
    `Настроение: ${mood}\n` +
    `Голос: ${voice}\n` +
    `Пожелания и история от заказчика: ${wishes}`;

  let text, res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.ai.apiKey}`,
        },
        body: JSON.stringify({
          model: config.ai.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 2000,
          temperature: 0.9,
        }),
      });
      text = await res.text();
      if (res.ok) break;
      console.log(`[ai] attempt ${attempt}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`[ai] attempt ${attempt}: ${e.message}`);
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = JSON.parse(text);
  const lyrics = data.choices?.[0]?.message?.content?.trim();
  if (!lyrics) {
    throw new Error('AI не вернул текст песни');
  }

  // Формируем tags для SUNO из жанра и настроения
  const tags = [genre, mood, voice].filter(Boolean).join(', ');

  // Пытаемся извлечь название из первой строки или генерируем из повода
  const title = extractTitle(lyrics, occasion, wishes);

  return { lyrics, tags, title };
}

function extractTitle(lyrics, occasion, wishes) {
  // Берём имя из пожеланий (первое слово с большой буквы после типичных фраз)
  const nameMatch = wishes.match(/(?:для|мужу|жене|маме|папе|другу|подруге|сыну|дочке|брату|сестре)\s+(\p{Lu}\p{Ll}+)/u);
  const name = nameMatch ? nameMatch[1] : null;

  if (name && occasion) {
    return `${occasion} — ${name}`;
  }
  if (name) {
    return `Песня для ${name}`;
  }
  return `${occasion || 'Персональная песня'}`;
}
