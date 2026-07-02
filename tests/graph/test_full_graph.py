# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the COMPREHENSIVE knowledge-graph data artifact
# (spine + concept graph + card leaves). Out-of-process:
#   out/pyenv/bin/python -m pytest tests/graph/test_full_graph.py

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_full_graph as bfg  # noqa: E402

CARDS_DIR = ROOT / "graph" / "cards_gen"


def test_builds_and_is_comprehensive():
    g = bfg.build()
    n = len(g["nodes"])
    # concepts alone give ~6k; with the generated card layer the graph exceeds 10k.
    assert n > 6000
    if any(CARDS_DIR.glob("cards_*.json")):
        assert n > 10000, f"expected a 10k+ node comprehensive graph, got {n}"


def test_spine_present_and_sections_are_the_default():
    g = bfg.build()
    kinds: dict[str, int] = {}
    appear = {}
    for node in g["nodes"]:
        kinds[node["kind"]] = kinds.get(node["kind"], 0) + 1
        appear[node["id"]] = node["appear"]
    assert kinds["section"] == 4 and kinds["fc"] == 10 and kinds["category"] == 31 and kinds["cars"] == 3
    # The 4 sections are the minimalist default (appear at slider 0).
    for node in g["nodes"]:
        if node["kind"] == "section":
            assert node["appear"] == 0.0


def test_appear_thresholds_are_ordered_and_bounded():
    # Every node's appear is in [0,1], and a child never appears before its parent (so the slider can
    # never reveal an orphan — parents always stream in first).
    g = bfg.build()
    appear = {node["id"]: node["appear"] for node in g["nodes"]}
    for node in g["nodes"]:
        a = node["appear"]
        assert 0.0 <= a <= 1.0, node["id"]
        p = node.get("parent")
        if p in appear:
            assert a >= appear[p], f"{node['id']} appears before its parent {p}"


def test_edges_reference_known_nodes():
    g = bfg.build()
    ids = {node["id"] for node in g["nodes"]}
    for e in g["edges"]:
        assert e["src"] in ids and e["dst"] in ids, e
