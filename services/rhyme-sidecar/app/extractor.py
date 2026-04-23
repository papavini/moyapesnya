"""
Lyrics parsing helpers: split into lines, skip section headers and blank lines,
extract the last word of each line, and collect pairs for classification.

All functions are pure — the accentizer callable is injected by main.py so
tests do not need to load ruaccent.
"""

import re

SECTION_HEADER_RE = re.compile(r'^\s*\[[^\]]+\]\s*$')
# Trailing punctuation stripped from the final token of each line.
TRAILING_PUNCT_RE = re.compile(r'[\s.,!?;:—–\-«»"\'()…]+$')
# Token split — whitespace.
SPLIT_WS = re.compile(r'\s+')


def iter_lyrics_lines(lyrics: str):
    """
    Yields each non-empty, non-header line stripped of leading/trailing whitespace.
    Section headers (`[Куплет 1]`, `[Припев]`, etc.) and empty lines are skipped.
    """
    if not lyrics:
        return
    for raw in lyrics.splitlines():
        line = raw.strip()
        if not line:
            continue
        if SECTION_HEADER_RE.match(line):
            continue
        yield line


def extract_final_word(line: str) -> str:
    """
    Returns the last token of the line, lowercased, trailing punctuation stripped.
    The '+' stress marker is stripped — this is the DISPLAY form (what we show the user
    and the critic in logs). The accented form with '+' is preserved separately
    inside build_pair_candidates.
    Returns '' if the line has no words.
    """
    if not line:
        return ''
    trimmed = TRAILING_PUNCT_RE.sub('', line).strip()
    if not trimmed:
        return ''
    tokens = SPLIT_WS.split(trimmed)
    if not tokens:
        return ''
    word = tokens[-1].strip().lower()
    word = word.strip('«»"\'()')
    # Strip '+' marker — display form never has the accent indicator.
    word = word.replace('+', '')
    return word


def build_pair_candidates(lyrics: str, accent_fn):
    """
    For each non-header line, return a dict:
        { 'raw': line.lower(),
          'final_word': <last word, lowercase, no trailing punct>,
          'accented_final_word': <accented form of final_word> }

    `accent_fn` takes a LINE (or a single word) and returns the accented string
    (containing '+' before each stressed vowel). main.py provides this wrapper
    around the RUAccent model.
    """
    entries = []
    for line in iter_lyrics_lines(lyrics):
        final_word = extract_final_word(line)
        if not final_word:
            continue
        # Pass the whole line to the accentizer so homographs get contextual resolution,
        # then pull out the accented form of the final token.
        try:
            accented_line = accent_fn(line) or line
        except Exception:
            accented_line = line
        # Tokenize the accented line the same way to find its last token.
        accented_line_trimmed = TRAILING_PUNCT_RE.sub('', accented_line).strip()
        accented_tokens = SPLIT_WS.split(accented_line_trimmed) if accented_line_trimmed else []
        accented_word = (accented_tokens[-1].strip().lower().strip('«»"\'()')
                         if accented_tokens else final_word)
        entries.append({
            'raw': line.lower(),
            'final_word': final_word,
            'accented_final_word': accented_word,
        })
    return entries


def collect_pairs(entries):
    """
    Yields tuples (i, j, entry_i, entry_j) for adjacent (i, i+1) and skip-one (i, i+2)
    pairs across all lines. Duplicates on sorted (final_word_a, final_word_b) are
    filtered so each unordered pair is classified at most once. Self-pairs skipped.
    """
    seen = set()
    n = len(entries)
    for i in range(n):
        for j in (i + 1, i + 2):
            if j >= n:
                continue
            wa = entries[i]['final_word']
            wb = entries[j]['final_word']
            if not wa or not wb:
                continue
            if wa == wb:
                continue
            key = tuple(sorted((wa, wb)))
            if key in seen:
                continue
            seen.add(key)
            yield (i, j, entries[i], entries[j])
