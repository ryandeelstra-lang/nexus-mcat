# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the SYNTHESIZED DOK-1 corpus (ai/corpus/cards/) — the comprehensive prefilled deck.
# The tiny self-authored seed is pinned separately in tests/test_deck_content.py; this file pins the
# large synthesized corpus that covers every knowledge-graph node.
# Out-of-process (run explicitly, not part of `just check`):
#   PYTHONPATH= out/pyenv/bin/python -m pytest tests/test_corpus.py

import json
from pathlib import Path

import yaml  # type: ignore[import-untyped]

from ai.leakage import scan
from ai.provenance import ProvenanceStore

ROOT = Path(__file__).resolve().parents[1]
CORPUS_DIR = ROOT / "ai" / "corpus" / "cards"
SOURCES = ROOT / "ai" / "corpus" / "sources.jsonl"
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
EVAL_GOLD = ROOT / "eval_gold"

# Per-leaf coverage floors (Decision: ~60-120 content target; CARS is skill-based → fewer method cards).
CONTENT_MIN = 50
CARS_MIN = 12


def _leaves():
    return yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))["leaves"]


def _corpus_cards():
    cards = []
    if CORPUS_DIR.exists():
        for p in sorted(CORPUS_DIR.glob("*.jsonl")):
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    c = json.loads(line)
                    c["_file"] = p.name
                    cards.append(c)
    return cards


def test_every_leaf_meets_the_coverage_floor():
    """Every one of the 34 taxonomy leaves has a corpus that meets its per-leaf floor — no dark node."""
    by_leaf: dict[str, int] = {}
    for c in _corpus_cards():
        by_leaf[c["leaf_id"]] = by_leaf.get(c["leaf_id"], 0) + 1
    shortfalls = []
    for leaf in _leaves():
        lid = leaf["leaf_id"]
        floor = CARS_MIN if leaf["section"] == "CARS" else CONTENT_MIN
        if by_leaf.get(lid, 0) < floor:
            shortfalls.append(f"{lid}: {by_leaf.get(lid, 0)} < {floor}")
    assert not shortfalls, shortfalls


def test_corpus_schema_and_paths_match_taxonomy():
    leaves = {l["leaf_id"]: l for l in _leaves()}
    for c in _corpus_cards():
        assert c["leaf_id"] in leaves, c
        assert c["deck_path"] == leaves[c["leaf_id"]]["path"], c
        assert c["front"].strip() and c["back"].strip(), c
        assert c.get("dok") == 1, c


def test_every_corpus_card_is_sourced_c2():
    """C2 gate: every synthesized card's source_id must resolve to a known source, or it is blocked."""
    store = ProvenanceStore.from_jsonl(SOURCES)
    for c in _corpus_cards():
        store.assert_sourced(c)  # raises ProvenanceError on unsourced/unresolvable


def test_no_near_duplicate_fronts_within_corpus():
    """Cheap intra-corpus dedup: no two cards share a normalized-identical front (a lazy copy)."""
    from ai.leakage import normalize

    seen: dict[str, str] = {}
    dups = []
    for c in _corpus_cards():
        key = normalize(c["front"])
        if key in seen:
            dups.append((seen[key], c["leaf_id"], c["front"][:60]))
        else:
            seen[key] = c["leaf_id"]
    assert not dups, dups[:10]


def test_corpus_provenance_disjoint_from_eval_gold():
    """7e wall (structural): the corpus source set must be disjoint from the held-out gold source set."""
    corpus_src = {c.get("source_id") for c in _corpus_cards()}
    gold_src = set()
    for p in EVAL_GOLD.glob("**/*.jsonl"):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                gold_src.add(json.loads(line).get("provenance_source"))
    overlap = corpus_src & gold_src
    assert not overlap, f"leakage: shared provenance between corpus and gold: {overlap}"


def test_corpus_leakage_clean_vs_eval_gold():
    """7e wall (lexical backstop): no corpus card is a near-dup of any held-out gold item."""
    gold_texts = []
    for p in EVAL_GOLD.glob("**/*.jsonl"):
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip():
                g = json.loads(line)
                gold_texts.append(f"{g.get('front', '')} {g.get('back', '')}".strip())
    other = [f"{c['front']} {c['back']}" for c in _corpus_cards()]
    leaks = scan(gold_texts, other)
    assert not leaks, leaks[:10]
