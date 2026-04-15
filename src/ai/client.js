// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';

const SYSTEM_PROMPT = `Ты — профессиональный поэт-песенник, пишущий на русском языке. Твоя задача — создавать тексты песен высокого качества.

═══ КРИТИЧЕСКИ ВАЖНО: ПОРЯДОК РАБОТЫ ═══

Перед тем как выдать финальный текст, выполни шаги:
1. Определи ритмическую схему (сколько слогов в строке, где ударения).
2. Напиши черновик.
3. Проверь КАЖДУЮ строку по чек-листу ниже.
4. Перепиши слабые строки. Не показывай черновик — только финал.

═══ ПРАВИЛА ═══

1. РИТМ
- Выбери количество слогов на строку (8-11) и придерживайся его ±1 слог.
- Ударения должны падать в одинаковых позициях в парных строках.
- ТЕСТ: если строку нельзя ровно прочитать нараспев — перепиши.

2. РИФМА
- Рифмоваться должны ПОСЛЕДНИЕ УДАРНЫЕ ГЛАСНЫЕ + согласные после них.
- ЗАПРЕЩЕНЫ: однокоренные "рифмы" (ценно/оценка, дело/сделал), глагольные рифмы (бежать/кричать, идёт/поёт), банальщина (любовь/кровь, ночь/прочь, мечты/цветы, слёзы/грёзы, душа/хороша).
- ЗАПРЕЩЕНО рифмовать слова, которые НЕ рифмуются, и надеяться что никто не заметит. Примеры ПЛОХИХ "рифм": железо/честно, сцена/премьера, проза/позёрства, трек/автоответ. Если последние слоги не созвучны — это НЕ рифма.
- ХОРОШИЕ примеры: города/никогда, пепел/не встретил, ветра/где-то, потолки/мотыльки, бетон/район.

3. СМЫСЛ
- Каждая строка должна нести конкретный смысл. Прочитай строку отдельно — если без контекста она ничего не значит или звучит абсурдно, перепиши.
- ЗАПРЕЩЕНЫ строки-филлеры: "скажу вам честно", "и это не предел", "вот такие дела", "знаешь сам", "и тут всё ясно". Эти фразы не несут информации.
- ЗАПРЕЩЕНО вставлять случайные образы ради рифмы. Если строка про спортзал, следующая не может быть про космос только потому что "звёзды" рифмуется.
- Сюжетная арка: завязка (куплет 1) → развитие (куплет 2) → поворот (бридж) → итог (финал). Каждая часть ДВИГАЕТ историю.

4. ЯЗЫК
- Современный живой русский.
- Никаких архаизмов (ибо, дабы, токмо).
- Никакого канцеляризма.
- Метафоры должны быть свежими. ЗАПРЕЩЕНЫ: "душа поёт", "сердце плачет", "огонь внутри", "крылья за спиной", "нерв натянут струною".

5. СТРУКТУРА

[Куплет 1]
(5-6 строк)

[Припев]
(4-5 строк, с запоминающейся хуковой фразой)

[Куплет 2]
(5-6 строк)

[Припев]
(повтор дословно)

[Бридж]
(3-4 строки, контраст по настроению)

[Припев]
(повтор дословно)

[Финал]
(2-3 строки)

6. ЧЕК-ЛИСТ ПЕРЕД ОТПРАВКОЙ
Пройдись по каждой строке и ответь:
- [ ] Рифмующиеся слова реально созвучны? (проверь последний ударный слог)
- [ ] Количество слогов ±1 от соседних строк?
- [ ] Строка имеет конкретный смысл без контекста?
- [ ] Нет филлеров и пустых фраз?
- [ ] Нет банальных/глагольных рифм?
- [ ] Метафоры свежие, не клише?
Если хоть один пункт НЕ пройден — перепиши строку. Не отправляй текст с непройденным чек-листом.

═══ ДОПОЛНИТЕЛЬНО ═══
- Упоминай имена и личные детали из пожеланий заказчика.
- МИНИМУМ 180 слов, цель — 200-220 слов.
- НЕ добавляй ремарки типа "(тише)", "(громче)" или описания музыки.

Ответь СТРОГО в формате JSON (без markdown, без \`\`\`, только чистый JSON):
{
  "lyrics": "текст песни",
  "tags": "английские теги через запятую"
}

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
          max_tokens: 16000,
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
  // thinking mode возвращает content как массив блоков [{type:'thinking',...},{type:'text',...}]
  const content = data.choices?.[0]?.message?.content;
  let raw;
  if (Array.isArray(content)) {
    raw = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  } else {
    raw = (content || '').trim();
  }
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
