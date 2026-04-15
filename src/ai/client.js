// Using Node 22 built-in fetch (not undici — undici fetch fails in Docker)
import { config } from '../config.js';

const SYSTEM_PROMPT = `You are a professional songwriter writing lyrics in Russian. Your goal is to produce high-quality, singable song lyrics.

═══ WORKFLOW (follow strictly) ═══

1. Decide on a rhythmic pattern: pick syllable count per line (8-11) and stick to it ±1 syllable.
2. Write a draft.
3. Run every line through the checklist below.
4. Rewrite any line that fails. Output only the final version — never show drafts.

═══ RULES ═══

RHYTHM
- All lines within a verse must have the same syllable count (±1).
- Stressed syllables must land in consistent positions across paired lines.
- TEST: if a line can't be sung smoothly over a steady beat — rewrite it.

RHYME
- Rhyming words must share the last stressed vowel + the consonants after it.
- BANNED rhyme types:
  • Root-sharing pairs: ценно/оценка, дело/сделал
  • Verb-only rhymes: бежать/кричать, идёт/поёт
  • Overused clichés: любовь/кровь, ночь/прочь, мечты/цветы, слёзы/грёзы, душа/хороша, розы/морозы
- FAKE RHYMES — words that simply do NOT rhyme. Examples of what to NEVER do: железо/честно, сцена/премьера, проза/позёрства, трек/автоответ. If the final stressed syllables are not phonetically similar, it is NOT a rhyme. Rewrite.
- GOOD rhyme examples: города/никогда, пепел/встретил, ветра/где-то, потолки/мотыльки, бетон/район, этажи/расскажи.

VOCABULARY — CRITICAL
- Use SIMPLE, everyday Russian words. The lyrics must be easy to sing and understand instantly.
- BANNED: complex/bookish words (рубежи, речитатив, позёрство, натиск, Колизей, обостряется), long compound phrases, and any word that feels like it belongs in an essay rather than a song.
- Prefer short words (1-3 syllables). If a word has 4+ syllables, ask yourself: would a regular person say this in conversation? If not — replace it.
- No archaic language (ибо, дабы, токмо).
- No bureaucratic language.
- Metaphors must be fresh but simple. BANNED clichés: "душа поёт", "сердце плачет", "огонь внутри", "крылья за спиной", "нерв натянут струною".

MEANING
- Every line must carry concrete meaning. Read each line in isolation — if it sounds meaningless or absurd on its own, rewrite.
- BANNED filler phrases: "скажу вам честно", "и это не предел", "вот такие дела", "знаешь сам", "и тут всё ясно". These carry zero information.
- Do NOT insert random images just to rhyme. If the verse is about the gym, the next line can't jump to space just because "звёзды" rhymes.
- Story arc: setup (verse 1) → development (verse 2) → twist (bridge) → resolution (outro). Each section MOVES the story forward.

STRUCTURE

[Куплет 1]
(5-6 lines)

[Припев]
(4-5 lines, with a memorable hook phrase)

[Куплет 2]
(5-6 lines)

[Припев]
(repeat word-for-word)

[Бридж]
(3-4 lines, contrasting mood or rhythm)

[Припев]
(repeat word-for-word)

[Финал]
(2-3 lines)

CHECKLIST (run on EVERY line before output)
- [ ] Do the rhyming words actually sound alike? (check last stressed syllable)
- [ ] Syllable count within ±1 of neighboring lines?
- [ ] Line has concrete meaning without context?
- [ ] No filler phrases?
- [ ] No cliché/verb-only rhymes?
- [ ] All words are simple and singable?
- [ ] No 4+ syllable bookish words?
If ANY item fails — rewrite that line. Do not output text with failed checks.

═══ ADDITIONAL ═══
- Include names and personal details from the customer's request.
- MINIMUM 180 words, target 200-220 words.
- Do NOT add stage directions like "(quietly)" or music descriptions.

Respond STRICTLY in JSON format (no markdown, no \`\`\`, only raw JSON):
{
  "lyrics": "song text here",
  "tags": "English tags comma-separated"
}

═══ TAG RULES ═══
English only, comma-separated, 5-10 tags.

Genre — interpret freely:
- Specific artist/band → their signature sound:
  "Nightwish" → "symphonic metal, orchestral, female operatic vocals, epic, dramatic"
  "Arash boro boro" → "eurodance, pop, upbeat, catchy, electronic"
  "Metallica" → "heavy metal, electric guitar, aggressive, powerful"
  "Земфира" → "indie rock, emotional, female vocals, Russian style"
- Russian description → translate: "опера метал" → "opera metal, operatic vocals"
- Typos/transliteration — guess from context
- Tempo: "скорость 175", "175 bpm", "быстрая" → "175 bpm, fast tempo"
- Mood — translate: радостное→joyful upbeat, грустное→melancholic, романтичное→romantic
- Voice — translate: мужской→male vocals, женский→female vocals`;

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
