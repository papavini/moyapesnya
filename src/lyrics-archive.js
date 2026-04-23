// Persistent archive of every delivered song.
// Writes a markdown file per order to $LYRICS_ARCHIVE_DIR (default ./delivered/<YYYY-MM-DD>/).
// Contents: order data (occasion/genre/mood/voice/wishes) + analyzer portrait + pipeline
// metrics + final lyrics + SUNO clip URLs + rewrite provenance.
//
// Motivation: journalctl truncates long `[telegram] AI OK, lyrics: ...` lines at ~50 chars,
// so good songs users loved were unrecoverable. The archive is the canonical store for
// post-hoc analysis, A/B corpus building, and the .planning/best-lyrics/ reference set.
//
// Never throws — archive is a nice-to-have, not a dependency. On any failure we log and
// continue so the user still gets their song delivered.

import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DIR = process.env.LYRICS_ARCHIVE_DIR || './delivered';

function pad(n) {
  return String(n).padStart(2, '0');
}

function slugify(input, max = 40) {
  if (!input) return 'untitled';
  return input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max) || 'untitled';
}

function formatFakePairs(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return '(none)';
  return pairs.map(p => `«${p[0]} / ${p[1]}»`).join(', ');
}

function formatCritique(critique) {
  if (!critique) return '*(critic not called or failed)*';
  const dims = ['story_specificity', 'chorus_identity', 'rhyme_quality', 'singability', 'emotional_honesty'];
  const lines = [
    `- **total:** ${critique.total}/15`,
    `- **keep_sections:** ${JSON.stringify(critique.keep_sections || [])}`,
    '',
    '| Dimension | Score | Rewrite instruction |',
    '|---|---:|---|',
  ];
  for (const d of dims) {
    const e = critique[d] || {};
    const ri = (e.rewrite_instructions || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300);
    lines.push(`| ${d} | ${e.score ?? '?'} | ${ri || '—'} |`);
  }
  return lines.join('\n');
}

function buildMarkdown({ platform, userId, order, result, clips, nowIso }) {
  const { portrait, metrics, critique, was_rewritten, original_lyrics, lyrics, tags, title } = result || {};
  const rhymes = metrics?.rhymes || {};

  const lines = [
    `# ${title || order?.occasion || 'Песня'}`,
    '',
    `- **Timestamp:** ${nowIso}`,
    `- **Platform:** ${platform}`,
    `- **User:** ${userId}`,
    `- **Pipeline outcome:** ${was_rewritten ? 'REWRITE ACCEPTED' : 'ORIGINAL DRAFT (no rewrite)'}`,
    '',
    '## Order',
    '```',
    `occasion: ${order?.occasion || ''}`,
    `genre:    ${order?.genre || ''}`,
    `mood:     ${order?.mood || ''}`,
    `voice:    ${order?.voice || ''}`,
    '```',
    '',
    '### Wishes',
    '```',
    (order?.wishes || '').trim() || '(empty)',
    '```',
    '',
    '## Portrait (Step U)',
    portrait
      ? '```json\n' + JSON.stringify(portrait, null, 2) + '\n```'
      : '*(analyzer returned null — wishes-only generation)*',
    '',
    '## Metrics',
    '```json',
    JSON.stringify({
      banale_pairs: metrics?.banale_pairs,
      syllable_violations: metrics?.syllable_violations,
      lexical_diversity: metrics?.lexical_diversity,
      lost_facts: metrics?.lost_facts,
      rhymes: {
        true: (rhymes.true || []).length,
        approximate: (rhymes.approximate || []).length,
        fake: (rhymes.fake || []).length,
      },
      skip_pipeline: metrics?.skip_pipeline,
    }, null, 2),
    '```',
    '',
    '### Fake rhymes detected',
    formatFakePairs(rhymes.fake),
    '',
    '## Critique',
    formatCritique(critique),
    '',
    '## Tags (SUNO)',
    '```',
    tags || '',
    '```',
    '',
    '## Lyrics (delivered)',
    '```',
    (lyrics || '').trim(),
    '```',
  ];

  if (was_rewritten && original_lyrics) {
    lines.push(
      '',
      '## Original draft (pre-rewrite, for A/B reference)',
      '```',
      original_lyrics.trim(),
      '```',
    );
  }

  if (Array.isArray(clips) && clips.length) {
    lines.push('', '## SUNO clips');
    for (const c of clips) {
      lines.push(`- [${c.id || 'clip'}](${c.audioUrl || ''})${c.title ? ` — ${c.title}` : ''}`);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Save a delivered song to the archive. Never throws.
 * @param {object} args
 * @param {string} args.platform  — 'telegram' | 'vk'
 * @param {number|string} args.userId
 * @param {object} args.order     — { occasion, genre, mood, voice, wishes }
 * @param {object} args.result    — pipeline output incl. portrait, metrics, critique, was_rewritten, original_lyrics, lyrics, tags, title
 * @param {Array}  args.clips     — SUNO clips [{ id, audioUrl, title }]
 * @returns {Promise<string|null>} path to saved file, or null on failure
 */
export async function saveDeliveredLyrics({ platform, userId, order, result, clips }) {
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const dateDir = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timePart = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const slug = slugify(result?.title || order?.occasion || 'song');

    const dir = path.resolve(DEFAULT_DIR, dateDir);
    await fs.mkdir(dir, { recursive: true });

    const file = path.join(dir, `${timePart}-${platform}-${userId}-${slug}.md`);
    const md = buildMarkdown({ platform, userId, order, result, clips, nowIso });
    await fs.writeFile(file, md, 'utf8');
    console.log(`[archive] saved ${file}`);
    return file;
  } catch (e) {
    console.warn('[archive] save failed:', e.message);
    return null;
  }
}
