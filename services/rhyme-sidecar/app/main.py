"""
FastAPI rhyme detector sidecar.

Run locally:
    uvicorn app.main:app --host 127.0.0.1 --port 3100 --workers 1

Endpoints:
    POST /detect  { "lyrics": "..." }  →  { "rhymes": {...}, "stats": {...} }
    GET  /health                        →  { "ok": true, "model_loaded": bool }

Model loading happens in lifespan (once per process). First request after cold
start may be slow as ruaccent downloads its model weights.

The accentizer adapter tolerates API differences between ruaccent versions and
sibling packages (ru-accent-poet, ruaccent-predictor) — anything that accepts a
string and returns a string with '+' before stressed vowels works.
"""

from contextlib import asynccontextmanager
from typing import Optional
import logging
import time

from fastapi import FastAPI
from pydantic import BaseModel, Field

from .classifier import classify_pair
from .extractor import build_pair_candidates, collect_pairs

logger = logging.getLogger('rhyme-sidecar')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(name)s] %(message)s')

# Mutable module-level state populated in lifespan.
_state = {'accent_fn': None, 'model_loaded': False}


def _default_accent_fn(text: str) -> str:
    """
    Fallback accentizer when ruaccent is not installed. Returns the input unchanged.
    classify_pair will then rely on 'ё' heuristic + single-vowel rule; multi-vowel
    words without '+' marker get ('', '') tails → FAKE classification (conservative).
    Used ONLY when the model fails to load — we keep serving requests so the Node
    side's graceful-degradation path sees a non-500 response with empty buckets.
    """
    return text


def _load_ruaccent():
    """
    Try to import and initialize ruaccent's RUAccent class. Returns a callable
    accent_fn(line: str) -> str, or None on failure.
    """
    try:
        from ruaccent import RUAccent  # type: ignore
    except Exception as e:
        logger.warning('ruaccent import failed: %s', e)
        return None

    try:
        acc = RUAccent()
        # Poetry preset is smaller and tuned for verse; use_dictionary keeps the
        # Zaliznyak-style lookup in RAM for O(1) lookups.
        try:
            acc.load(omograph_model_size='small_poetry', use_dictionary=True)
        except TypeError:
            # Older / newer API variants — fall back to no-kwargs load.
            acc.load()
        logger.info('ruaccent loaded (small_poetry + dict)')
        return lambda line: acc.process_all(line)
    except Exception as e:
        logger.warning('ruaccent init failed: %s', e)
        return None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    t0 = time.monotonic()
    fn = _load_ruaccent()
    if fn is None:
        logger.warning('no accentizer available — serving with pass-through fallback')
        _state['accent_fn'] = _default_accent_fn
        _state['model_loaded'] = False
    else:
        _state['accent_fn'] = fn
        _state['model_loaded'] = True
    logger.info('lifespan startup in %.2fs (model_loaded=%s)',
                time.monotonic() - t0, _state['model_loaded'])
    yield
    logger.info('lifespan shutdown')


app = FastAPI(title='Rhyme Detector Sidecar', version='1.0.0', lifespan=lifespan)


class DetectRequest(BaseModel):
    lyrics: str = Field(..., description='Full song draft including [Section] headers')


@app.get('/health')
def health():
    return {'ok': True, 'model_loaded': _state['model_loaded']}


@app.post('/detect')
def detect(req: DetectRequest):
    t0 = time.monotonic()
    accent_fn = _state['accent_fn'] or _default_accent_fn
    entries = build_pair_candidates(req.lyrics, accent_fn)

    buckets = {'true': [], 'approximate': [], 'fake': []}
    pairs_checked = 0
    for _, _, a, b in collect_pairs(entries):
        pairs_checked += 1
        kind = classify_pair(a['accented_final_word'], b['accented_final_word'])
        buckets[kind].append([a['final_word'], b['final_word']])

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        'detect: lines=%d pairs=%d true=%d approx=%d fake=%d elapsed=%dms',
        len(entries), pairs_checked,
        len(buckets['true']), len(buckets['approximate']), len(buckets['fake']),
        elapsed_ms,
    )
    return {
        'rhymes': buckets,
        'stats': {
            'lines': len(entries),
            'pairs_checked': pairs_checked,
            'model_loaded': _state['model_loaded'],
            'elapsed_ms': elapsed_ms,
        },
    }
