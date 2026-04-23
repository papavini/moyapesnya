"""
Phonetic classification of Russian rhyme pairs.

Returns one of 'true' | 'approximate' | 'fake' for a pair of accented line-final words.

Algorithm
---------
Input: two words annotated with stress position (a '+' marker before the stressed vowel,
       ё is considered always stressed, single-vowel words need no mark).
1. Extract the stressed vowel character and everything after it — the rhyme tail.
2. Normalize the tail:
     - apply final-devoicing on last non-soft-sign consonant:
       в→ф, б→п, д→т, г→к, з→с, ж→ш
     - strip hard sign (ъ)
     - keep soft sign (ь) as palatalization marker
3. Classify the pair (tail_a, tail_b):
     - stressed vowels differ (orthographic) → FAKE
     - tails identical after normalization → TRUE
     - stressed vowel matches, tails differ but non-empty → APPROXIMATE
     - cannot find stress in either word → FAKE (conservative)

Design notes
------------
* Orthographic comparison (а ≠ я, е ≠ э, о ≠ ё) is intentional — matches how the
  product's human listener judges rhymes and how critic feedback labels FAKE pairs
  (see src/ai/critic.js DIMENSION 3 examples).
* BANALE detection is NOT done here — Node.js side has the cluster list
  (src/ai/metrics.js BANNED_RHYME_CLUSTERS) and is the single source of truth.
* Pure functions — no I/O, no model dependency. The accentizer lives in main.py.
"""

STRESS_MARK = '+'
VOWELS = set('аеёиоуыэюя')
FINAL_DEVOICE = {
    'в': 'ф', 'б': 'п', 'д': 'т',
    'г': 'к', 'з': 'с', 'ж': 'ш',
}


def find_stress_index(accented: str) -> int:
    """
    Returns the 0-based index of the stressed vowel in the CLEAN (no '+') form.
    Rules in priority order:
      1. '+' marker immediately before a vowel → that vowel is stressed.
      2. 'ё' in the word → rightmost ё is stressed.
      3. Word contains exactly one vowel → that vowel is stressed.
      4. Otherwise → -1 (cannot determine).
    """
    if not accented:
        return -1
    # Replace ONLY the first '+' so `plus_idx` stays aligned with the clean-word index
    # of the character that was immediately after the marker.
    clean = accented.replace(STRESS_MARK, '', 1)
    clean_lower = clean.lower()

    # Rule 1: explicit '+' marker (convention: '+' appears immediately BEFORE the stressed vowel)
    if STRESS_MARK in accented:
        plus_idx = accented.index(STRESS_MARK)
        if plus_idx < len(clean_lower) and clean_lower[plus_idx] in VOWELS:
            return plus_idx
        # Malformed marker — fall through to ё / single-vowel rules

    # Rule 2: ё is always stressed
    if 'ё' in clean_lower:
        return clean_lower.rindex('ё')

    # Rule 3: single vowel
    vowel_positions = [i for i, ch in enumerate(clean_lower) if ch in VOWELS]
    if len(vowel_positions) == 1:
        return vowel_positions[0]

    return -1


def extract_tail(accented: str):
    """
    Returns (stressed_vowel, post_stress_tail) — both lowercase.
    Empty pair ('', '') if stress cannot be determined.
    """
    if not accented:
        return ('', '')
    clean = accented.replace(STRESS_MARK, '', 1).lower()
    pos = find_stress_index(accented)
    if pos < 0 or pos >= len(clean):
        return ('', '')
    return (clean[pos], clean[pos + 1:])


def normalize_tail(tail: str) -> str:
    """
    Apply final-devoicing to the last non-soft-sign consonant; strip ъ; keep ь.
    Pure string transformation on the post-stress tail.
    """
    if not tail:
        return tail
    chars = [c for c in tail if c != 'ъ']
    if not chars:
        return ''
    # Find last non-ь character for devoicing
    last_idx = len(chars) - 1
    while last_idx >= 0 and chars[last_idx] == 'ь':
        last_idx -= 1
    if last_idx >= 0 and chars[last_idx] in FINAL_DEVOICE:
        chars[last_idx] = FINAL_DEVOICE[chars[last_idx]]
    return ''.join(chars)


def classify_pair(accented_a: str, accented_b: str) -> str:
    """
    Main classifier. Returns 'true' | 'approximate' | 'fake'.
    Conservative default: any stress-extraction failure → FAKE.
    """
    va, raw_ta = extract_tail(accented_a)
    vb, raw_tb = extract_tail(accented_b)

    # No stress determined → cannot classify safely → FAKE
    if not va or not vb:
        return 'fake'

    # Orthographic vowel mismatch is the dominant FAKE signal
    # (а/я, о/ё, е/э, и/ы treated as different for Russian rhyme per product convention).
    if va != vb:
        return 'fake'

    ta = normalize_tail(raw_ta)
    tb = normalize_tail(raw_tb)

    # Both tails empty (stressed vowel at end of word) AND stressed vowel matches → TRUE.
    if ta == tb:
        return 'true'

    # Same stressed vowel, differing non-empty tails → APPROXIMATE.
    # Examples kept as APPROXIMATE by design: готово/корона (во/на), лужи/нужно (жи/жно),
    # кросс/слёз (сс/з).
    return 'approximate'
