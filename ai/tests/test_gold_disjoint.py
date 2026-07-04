# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_gold_disjoint.py
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GOLD = REPO / "eval_gold" / "cardcheck_gold.jsonl"
SPLIT = REPO / "ai" / "gold" / "split.json"
CORPUS_SRC = REPO / "ai" / "corpus" / "sources.jsonl"
DECK = REPO / "deck_content" / "cards.jsonl"


def _gold():
    return [json.loads(l) for l in GOLD.read_text(encoding="utf-8").splitlines() if l.strip()]


def test_gold_pool_shape_and_provenance_disjoint():
    pool = _gold()
    assert len(pool) >= 90
    for g in pool:
        assert g["gold_answer"].strip() and g["question"].strip() and g["provenance_source"].strip()
    gold_prov = {g["provenance_source"] for g in pool}
    corpus_prov = {json.loads(l)["source_id"] for l in CORPUS_SRC.read_text().splitlines() if l.strip()}
    deck_prov = {json.loads(l)["provenance"] for l in DECK.read_text().splitlines() if l.strip()}
    assert not (gold_prov & (corpus_prov | deck_prov)), "gold must be provenance-disjoint from corpus+deck"


def test_split_is_frozen_and_pairwise_disjoint():
    split = json.loads(SPLIT.read_text(encoding="utf-8"))
    tune, dev, held = set(split["tune"]), set(split["dev"]), set(split["heldout"])
    ids = {g["id"] for g in _gold()}
    assert tune <= ids and dev <= ids and held <= ids
    assert not (tune & dev) and not (tune & held) and not (dev & held)
    assert len(held) >= 50 and len(dev) >= 20 and len(tune) >= 20
