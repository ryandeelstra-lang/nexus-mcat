# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the knowledge-graph sidecar (Block I / T-GRAPH). Out-of-process:
#   PYTHONPATH= out/pyenv/bin/python -m pytest tests/graph/test_graph_sidecar.py

import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[2]  # tests/graph/ -> tests -> fork root
sys.path.insert(0, str(ROOT / "scripts"))
import build_graph_sidecar as bgs  # noqa: E402

TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
SIDECAR = ROOT / "graph" / "sidecar.json"


def test_node_count_and_kinds():
    sc = bgs.build()
    kinds: dict[str, int] = {}
    for n in sc["nodes"]:
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    assert len(sc["nodes"]) == 48
    assert kinds == {"section": 4, "fc": 10, "category": 31, "cars": 3}


def test_every_node_maps_to_a_real_taxonomy_id():
    sc = bgs.build()
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    valid = (
        {s["abbrev"] for s in tax["sections"]}
        | {fc["id"] for fc in tax["foundational_concepts"]}
        | {leaf["leaf_id"] for leaf in tax["leaves"]}
    )
    for n in sc["nodes"]:
        assert n["id"] in valid, n["id"]


def test_edges_reference_known_nodes():
    sc = bgs.build()
    ids = {n["id"] for n in sc["nodes"]}
    for e in sc["edges"]:
        assert e["src"] in ids and e["dst"] in ids, e


def test_prerequisite_edges_form_a_dag():
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


def test_sidecar_under_100kb():
    bgs.build()
    assert SIDECAR.stat().st_size < 100 * 1024


def test_builder_does_not_import_the_engine():
    bgs.build()
    offenders = [m for m in sys.modules if m == "anki" or m.startswith("anki.")]
    assert not offenders, f"the sidecar builder must not import the Anki engine: {offenders}"
