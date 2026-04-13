// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';

const SYSTEM_PROMPT = `Ты — профессиональный русский поэт и автор песен.

Ты пишешь красивые, душевные тексты на русском языке.
Используешь простые, понятные слова — так, чтобы каждый человек почувствовал эти строки сердцем.
Твои тексты живые, искренние, трогательные — не пафосные и не сухие.

Ответь СТРОГО в формате JSON (без markdown, без \`\`\`, только чистый JSON):
{
  "lyrics": "текст песни",
  "tags": "английские теги через запятую"
}

═══ ПРАВИЛА ДЛЯ ТЕКСТА (lyrics) ═══
Структура СТРОГО:
[Куплет 1]
(5-6 строк)

[Припев]
(4-5 строк)

[Куплет 2]
(5-6 строк)

[Бридж]
(3-4 строки)

[Припев]
(повтор припева дословно)

[Финал]
(2-3 строки)

РИФМОВКА: ABAB в куплетах (строки 1 и 3 рифмуются, 2 и 4 рифмуются), AABB в припеве. Рифмы настоящие, не приблизительные.

РИТМ: каждая строка 7–9 слогов, читается естественно вслух.
Пример нужного ритма: "Ты смотришь в окно и молчишь" — вот такой ритм нужен везде.

ЗАПРЕЩЕНЫ штампы и банальные рифмы: звёзды/слёзы, мечты/цветы, любовь/вновь, навсегда, вечно, душа/небеса, сердце/дверца.
Вместо абстракций — конкретные детали: запахи, предметы, действия человека.
Плохо: "Ты навсегда в моей душе" / Хорошо: "Ты забыла шарф на вешалке"

- Пиши ТОЛЬКО текст, без пояснений
- МИНИМУМ 180 слов, цель — 200-220 слов. Не обрывай текст раньше времени, каждая часть должна быть полноценной!
- Упоминай имена и личные детали из пожеланий
- НЕ добавляй ремарки типа "(тише)" или описания музыки

═══ ПРАВИЛА ДЛЯ ТЕГОВ (tags) ═══
Только по-английски, через запятую, 5-10 тегов.

Жанр — интерпретируй свободно:
- Конкретный артист/группа → их характерный звук и жанр:
  "Nightwish" → "symphonic metal, orchestral, female operatic vocals, epic, dramatic"
  "Arash boro boro" → "eurodance, pop, upbeat, catchy, electronic"
  "Metallica" → "heavy metal, electric guitar, aggressive, powerful"
  "Земфира" → "indie rock, emotional, female vocals, Russian style"
- Русское описание → переведи: "опера метал" → "opera metal, operatic vocals"
- Опечатки/транслит — угадывай по контексту
- Темп/скорость: "скорость 175", "175 bpm", "быстрая" → "175 bpm, fast tempo"
- Настроение (mood) — переведи: радостное→joyful upbeat, грустное→melancholic, романтичное→romantic
- Голос (voice) — переведи: мужской→male vocals, женский→female vocals`;

/**
 * Генерирует текст песни через OpenRouter (Gemini Flash Lite).
 * Возвращает lyrics (русский текст) + tags (английские SUNO дескрипторы).
 */
export async function generateLyrics({ occasion, genre, mood, voice, wishes }) {
  if (!config.ai.apiKey) {
    throw new Error('OPENROUTER_API_KEY не задан');
  }

  const userPrompt =
    `Напиши песню на русском языке.\n` +
    `Повод: ${occasion}\n` +
    `Жанр/стиль: ${genre}\n` +
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
          reasoning: { effort: 'high' },
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
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error('AI не вернул текст');
  }

  // Парсим JSON от AI
  let parsed;
  try {
    // Убираем возможные markdown-обёртки если модель всё равно добавила
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    // Fallback: если AI не вернул JSON — считаем весь ответ текстом песни
    console.log('[ai] JSON parse failed, using raw as lyrics. Error:', e.message);
    parsed = { lyrics: raw, tags: null };
  }

  const lyrics = (parsed.lyrics || '').trim();
  if (!lyrics) {
    throw new Error('AI не вернул текст песни');
  }

  // Теги от AI или fallback на ручную сборку
  const tags = parsed.tags
    ? parsed.tags.trim()
    : [genre, mood, voice].filter(Boolean).join(', ');

  console.log('[ai] tags:', tags);

  const title = extractTitle(lyrics, occasion, wishes);

  return { lyrics, tags, title };
}

function extractTitle(lyrics, occasion, wishes) {
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
