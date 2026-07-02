# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the deck-content provenance + the leakage wall (challenge 7e).
# Out-of-process (run explicitly, not part of `just check`):
#   PYTHONPATH= out/pyenv/bin/python -m pytest tests/test_deck_content.py

import json
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "deck_content" / "cards.jsonl"
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
EVAL_GOLD = ROOT / "eval_gold"


def _cards():
    return [json.loads(line) for line in CARDS.read_text(encoding="utf-8").splitlines() if line.strip()]


def _leaves_by_id():
    data = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    return {leaf["leaf_id"]: leaf for leaf in data["leaves"]}


def test_every_card_is_self_authored():
    for card in _cards():
        assert card["provenance"] == "self-authored-original", card


def test_card_leaf_ids_valid_and_paths_match_taxonomy():
    leaves = _leaves_by_id()
    for card in _cards():
        assert card["leaf_id"] in leaves, card["leaf_id"]
        assert card["deck_path"] == leaves[card["leaf_id"]]["path"]
        assert card["front"].strip() and card["back"].strip()


def test_deck_is_a_nonempty_tiny_seed():
    cards = _cards()
    assert 1 <= len(cards) <= 200  # a TINY seed deck; the full corpus is synthesized separately


def test_leakage_wall_provenance_disjoint_from_eval_gold():
    # Challenge 7e: the deck-content provenance set must be disjoint from the eval-gold set,
    # so no model grounded on deck content can have "seen" a held-out gold answer.
    deck_prov = {card["provenance"] for card in _cards()}
    gold_prov = set()
    for path in EVAL_GOLD.glob("**/*.jsonl"):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                gold_prov.add(json.loads(line).get("provenance_source"))
    overlap = deck_prov & gold_prov
    assert not overlap, f"leakage: shared provenance between deck and gold: {overlap}"
