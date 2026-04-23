"""
Unit tests for the rhyme classifier and extractor — no model load required.
All stress-annotated strings are hand-crafted so tests run standalone
(pytest services/rhyme-sidecar/tests -v).

Run from the sidecar directory:
    ./venv/bin/pytest tests/ -v
"""

import pytest

from app.classifier import (
    classify_pair,
    extract_tail,
    find_stress_index,
    normalize_tail,
)
from app.extractor import (
    build_pair_candidates,
    collect_pairs,
    extract_final_word,
    iter_lyrics_lines,
)


# ── stress / tail extraction ────────────────────────────────────────────────
# Convention: '+' marker goes IMMEDIATELY BEFORE the stressed vowel character
# — matches ruaccent's process_all output format.
class TestStressIndex:
    def test_explicit_marker(self):
        # "разгон": clean indexes р(0),а(1),з(2),г(3),о(4),н(5); stress on о (index 4)
        assert find_stress_index('разг+он') == 4

    def test_yo_always_stressed(self):
        assert find_stress_index('всё') == 2      # index of ё

    def test_single_vowel(self):
        # "ок": only vowel о at index 0 → single-vowel rule returns 0
        assert find_stress_index('ок') == 0

    def test_multiple_vowels_no_mark(self):
        # Multi-vowel word without a marker and without ё → undetermined.
        assert find_stress_index('глаза') == -1

    def test_empty(self):
        assert find_stress_index('') == -1


class TestExtractTail:
    def test_marker(self):
        # "путь": stress on у → 'п+уть'; tail = 'ть'
        assert extract_tail('п+уть') == ('у', 'ть')
        # "свернуть": stress on последняя у → 'сверн+уть'; tail = 'ть'
        assert extract_tail('сверн+уть') == ('у', 'ть')

    def test_yo(self):
        assert extract_tail('всё') == ('ё', '')

    def test_single_vowel_open(self):
        assert extract_tail('ок') == ('о', 'к')

    def test_undetermined_returns_empty(self):
        assert extract_tail('глаза') == ('', '')


class TestNormalizeTail:
    def test_final_devoicing(self):
        assert normalize_tail('в') == 'ф'
        assert normalize_tail('б') == 'п'
        assert normalize_tail('д') == 'т'
        assert normalize_tail('г') == 'к'
        assert normalize_tail('з') == 'с'
        assert normalize_tail('ж') == 'ш'

    def test_devoicing_skips_soft_sign(self):
        # ь at end doesn't block devoicing on the consonant before it.
        assert normalize_tail('дь') == 'ть'

    def test_hard_sign_stripped(self):
        assert normalize_tail('ъе') == 'е'

    def test_passthrough(self):
        assert normalize_tail('ть') == 'ть'


# ── pair classification ──────────────────────────────────────────────────────
class TestClassifyTrue:
    """Pairs that must be classified as TRUE — matching stressed vowel + identical tail."""

    def test_put_svernut(self):
        # путь → п+уть; свернуть → сверн+уть; both tails "ть".
        assert classify_pair('п+уть', 'сверн+уть') == 'true'

    def test_razgon_tron(self):
        # разгон → разг+он (stress о at index 4); трон → тр+он (stress о at index 2).
        assert classify_pair('разг+он', 'тр+он') == 'true'

    def test_lunu_tishinu(self):
        # Both end on stressed у (tail empty).
        assert classify_pair('лун+у', 'тишин+у') == 'true'

    def test_visok_ok(self):
        # висок → вис+ок; ок → stress on sole о (single-vowel rule).
        assert classify_pair('вис+ок', 'ок') == 'true'


class TestClassifyApproximate:
    """Pairs accepted in Russian pop — matching stressed vowel, differing tails."""

    def test_gotovo_korona(self):
        # готово → гот+ово (stress on middle о, tail "во"); корона → кор+она (stress on
        # middle о, tail "на"). Both stressed о, tails differ.
        assert classify_pair('гот+ово', 'кор+она') == 'approximate'

    def test_luzhi_nuzhno(self):
        # лужи → л+ужи (tail "жи"); нужно → н+ужно (tail "жно"). Both stressed у.
        assert classify_pair('л+ужи', 'н+ужно') == 'approximate'

    def test_kross_slyoz_different_orth_vowels(self):
        # кросс → кр+осс (stress о); слёз → сл+ёз (stress ё). ORTHOGRAPHICALLY different
        # vowels (о vs ё) → FAKE by our convention. Rationale: we intentionally follow
        # the critic prompt's orthographic convention (see src/ai/critic.js DIMENSION 3).
        assert classify_pair('кр+осс', 'сл+ёз') == 'fake'


class TestClassifyFake:
    """Pairs the critic kept letting through — stressed-vowel mismatch."""

    def test_vsyo_po_svoyemu(self):
        # всё (ё) vs по-своему (stress on first о of своему) → ё vs о → FAKE.
        assert classify_pair('всё', 'по-св+оему') == 'fake'

    def test_glaza_tebya(self):
        # глаза → глаз+а (stress final а); тебя → теб+я (stress final я). а vs я → FAKE.
        assert classify_pair('глаз+а', 'теб+я') == 'fake'

    def test_vsyo_kino(self):
        # всё (ё) vs кино (stress on о) → FAKE.
        assert classify_pair('всё', 'кин+о') == 'fake'

    def test_privet_otvet_phonetically_true(self):
        # привет → прив+ет; ответ → отв+ет. Both stress е, tails "т"/"т" → TRUE.
        # BANALE classification is NOT done here — Node side handles cluster lookup.
        assert classify_pair('прив+ет', 'отв+ет') == 'true'


class TestClassifyEdgeCases:
    def test_unresolvable_both_return_fake(self):
        # Multi-vowel words without any stress hint → conservative FAKE.
        assert classify_pair('глаза', 'тебя') == 'fake'

    def test_empty_strings(self):
        assert classify_pair('', '') == 'fake'

    def test_same_accented_string_is_true(self):
        # classify_pair does not filter same-word — collect_pairs does that upstream.
        assert classify_pair('п+уть', 'п+уть') == 'true'


# ── extractor tests ──────────────────────────────────────────────────────────
class TestExtractor:
    def test_iter_skips_headers_and_blanks(self):
        lyrics = '[Куплет 1]\nпервая строка\n\n[Припев]\nвторая строка\n'
        lines = list(iter_lyrics_lines(lyrics))
        assert lines == ['первая строка', 'вторая строка']

    def test_extract_final_word_strips_punctuation(self):
        assert extract_final_word('пошёл в путь,') == 'путь'
        assert extract_final_word('не свернуть!') == 'свернуть'
        assert extract_final_word('мы — дома.') == 'дома'

    def test_extract_final_word_handles_dash(self):
        assert extract_final_word('вот и всё —') == 'всё'

    def test_build_candidates_calls_accent_fn(self):
        # Test double: identity accent function. We still exercise the whole flow.
        lyrics = '[Куплет 1]\nв п+уть\nне сверн+уть\n'
        entries = build_pair_candidates(lyrics, lambda s: s)
        assert len(entries) == 2
        assert entries[0]['final_word'] == 'путь'       # '+' stripped from display form
        assert entries[1]['final_word'] == 'свернуть'
        assert entries[0]['accented_final_word'] == 'п+уть'
        assert entries[1]['accented_final_word'] == 'сверн+уть'

    def test_collect_pairs_adjacent_and_skipone(self):
        entries = [
            {'final_word': 'а', 'accented_final_word': 'а'},
            {'final_word': 'б', 'accented_final_word': 'б'},
            {'final_word': 'в', 'accented_final_word': 'в'},
            {'final_word': 'г', 'accented_final_word': 'г'},
        ]
        pairs = [(i, j) for i, j, _, _ in collect_pairs(entries)]
        # pairs should be (0,1),(0,2),(1,2),(1,3),(2,3)
        assert (0, 1) in pairs
        assert (0, 2) in pairs
        assert (1, 2) in pairs
        assert (1, 3) in pairs
        assert (2, 3) in pairs
        # (0,3) is NOT included — skip-two is out of scope.
        assert (0, 3) not in pairs

    def test_collect_pairs_dedup(self):
        # If two lines end with the same word, we skip (same-word self-pairs).
        entries = [
            {'final_word': 'путь', 'accented_final_word': 'пу+ть'},
            {'final_word': 'путь', 'accented_final_word': 'пу+ть'},
        ]
        pairs = list(collect_pairs(entries))
        assert pairs == []


# ── integration: end-to-end with hand-crafted accents ────────────────────────
class TestIntegration:
    def test_full_draft_with_fakes(self):
        """Simulate a draft with a known fake pair flowing through the full pipeline."""
        lyrics = (
            '[Куплет 1]\n'
            'я смотрю в её глаз+а\n'
            'и шепчу люблю теб+я\n'
        )
        entries = build_pair_candidates(lyrics, lambda s: s)  # identity — lines already accented
        buckets = {'true': [], 'approximate': [], 'fake': []}
        for _, _, a, b in collect_pairs(entries):
            kind = classify_pair(a['accented_final_word'], b['accented_final_word'])
            buckets[kind].append([a['final_word'], b['final_word']])
        assert len(buckets['fake']) == 1
        assert buckets['fake'][0] == ['глаза', 'тебя']
        assert len(buckets['true']) == 0
        assert len(buckets['approximate']) == 0
