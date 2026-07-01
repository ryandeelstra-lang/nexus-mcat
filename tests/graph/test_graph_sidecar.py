# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the knowledge-graph sidecar (Block I / T-GRAPH). Out-of-process:
#   PYTHONPATH= out/pyenv/bin/python -m pytest tests/graph/test_graph_sidecar.py
#
# The sidecar = the FROZEN 48-node spine (Decision 22) + the ADDITIVE Nexus topic layer
# (docs/data/mcat_topics.yaml: every AAMC-outline topic/subtopic + a verified topic prerequisite DAG).

import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[2]  # tests/graph/ -> tests -> fork root
sys.path.insert(0, str(ROOT / "scripts"))
import build_graph_sidecar as bgs  # noqa: E402

TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
TOPICS = ROOT / "docs" / "data" / "mcat_topics.yaml"
SIDECAR = ROOT / "graph" / "sidecar.json"


def _kinds(sc: dict) -> dict[str, int]:
    kinds: dict[str, int] = {}
    for n in sc["nodes"]:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    return kinds


def test_frozen_spine_preserved():
    # The 48-node coverage spine (Decision 22) is ALWAYS present, regardless of the additive topic layer.
    sc = bgs.build()
    kinds = _kinds(sc)
    assert kinds["section"] == 4
    assert kinds["fc"] == 10
    assert kinds["category"] == 31
    assert kinds["cars"] == 3


def test_topic_layer_is_additive_and_matches_source():
    # The topic layer is additive: its node counts match docs/data/mcat_topics.yaml exactly.
    sc = bgs.build()
    kinds = _kinds(sc)
    if not TOPICS.exists():
        return  # spine-only build is still valid
    tl = yaml.safe_load(TOPICS.read_text(encoding="utf-8")) or {}
    src = tl.get("topics", []) or []
    n_topic = sum(1 for t in src if t.get("kind") == "topic")
    n_sub = sum(1 for t in src if t.get("kind") == "subtopic")
    assert kinds.get("topic", 0) == n_topic
    assert kinds.get("subtopic", 0) == n_sub
    assert n_topic > 0 and n_sub > 0, "the Nexus topic layer should be populated"


def test_every_node_maps_to_a_real_taxonomy_id():
    sc = bgs.build()
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    valid = (
        {s["abbrev"] for s in tax["sections"]}
        | {fc["id"] for fc in tax["foundational_concepts"]}
        | {leaf["leaf_id"] for leaf in tax["leaves"]}
    )
    if TOPICS.exists():
        tl = yaml.safe_load(TOPICS.read_text(encoding="utf-8")) or {}
        valid |= {t["id"] for t in (tl.get("topics", []) or [])}
    for n in sc["nodes"]:
        assert n["id"] in valid, n["id"]


def test_edges_reference_known_nodes():
    sc = bgs.build()
    ids = {n["id"] for n in sc["nodes"]}
    for e in sc["edges"]:
        assert e["src"] in ids and e["dst"] in ids, e


def test_prerequisite_edges_form_a_dag():
    # Covers BOTH the spine's category-level prereqs and the additive topic-level prereqs.
    sc = bgs.build()
    pre = [(e["src"], e["dst"]) for e in sc["edges"] if e["kind"] == "prerequisite"]
    nodes = {x for edge in pre for x in edge}
    indeg = {n: 0 for n in nodes}
    adj: dict[str, list[str]] = {n: [] for n in nodes}
    for a, b in pre:
        indeg[b] += 1
        adj[a].append(b)
    queue = [n for n in nodes if indeg[n] == 0]
    seen = 0
    while queue:
        n = queue.pop()
        seen += 1
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)
    assert seen == len(nodes), "prerequisite edges contain a cycle (not a DAG)"


def test_topic_nodes_are_structural_with_no_deck_path():
    # Honesty wall: topic/subtopic nodes carry NO deck path — their mastery rolls up from the category
    # decks at render time, never a fabricated per-topic number.
    sc = bgs.build()
    for n in sc["nodes"]:
        if n["kind"] in ("topic", "subtopic"):
            assert n.get("path") is None, n["id"]


def test_topic_prerequisites_are_topic_level():
    # Topic-layer prereqs connect topic/subtopic ids only — never a bare content-category id (which would
    # break the category-grain "best next" pointer). Spine category prereqs live separately in the builder.
    if not TOPICS.exists():
        return
    tl = yaml.safe_load(TOPICS.read_text(encoding="utf-8")) or {}
    ids = {t["id"] for t in (tl.get("topics", []) or [])}
    for e in (tl.get("topic_prerequisites", []) or []):
        assert e["src"] in ids and e["dst"] in ids, e


def test_sidecar_size_bounded():
    # The outline-grain graph (~1.4k nodes) is far denser than the old 48-node spine, so the sidecar is
    # larger — but still a bounded, inline-able artifact. Guards against runaway growth.
    bgs.build()
    assert SIDECAR.stat().st_size < 640 * 1024


def test_builder_does_not_import_the_engine():
    bgs.build()
    offenders = [m for m in sys.modules if m == "anki" or m.startswith("anki.")]
    assert not offenders, f"the sidecar builder must not import the Anki engine: {offenders}"
