# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: pins the DEEP concept graph (the Category-altitude drill-down layer that lives
# UNDERNEATH the frozen 48-node spine). The spine itself is pinned by test_graph_sidecar.py and
# is untouched here. Out-of-process:
#   PYTHONPATH= out/pyenv/bin/python -m pytest tests/graph/test_concept_graph.py

import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_concept_graph as bcg  # noqa: E402

TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"


def _frozen_leaf_ids() -> set[str]:
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    return {leaf["leaf_id"] for leaf in tax["leaves"]}


def test_builds_and_has_substantial_coverage():
    res = bcg.build()
    g = res["graph"]
    # This is the "every concept on the MCAT" layer — assert it is genuinely large, not a stub.
    assert g["node_count"] >= 1000, g["node_count"]
    assert g["edge_count"] >= 1000, g["edge_count"]


def test_all_34_leaves_populated():
    res = bcg.build()
    per = res["node_by_leaf"]
    frozen = _frozen_leaf_ids()
    assert frozen.issubset(set(per)), frozen - set(per)
    # No frozen leaf left empty.
    empty = [lf for lf in frozen if per.get(lf, 0) == 0]
    assert not empty, f"leaves with no concepts: {empty}"


def test_every_node_rolls_up_to_one_frozen_leaf():
    res = bcg.build()
    frozen = _frozen_leaf_ids()
    for n in res["graph"]["nodes"]:
        assert n["leaf"] in frozen, n["id"]
        assert n["id"].startswith(n["leaf"] + "."), n["id"]


def test_node_ids_globally_unique():
    res = bcg.build()
    ids = [n["id"] for n in res["graph"]["nodes"]]
    assert len(ids) == len(set(ids))


def test_every_parent_resolves():
    res = bcg.build()
    frozen = _frozen_leaf_ids()
    ids = {n["id"] for n in res["graph"]["nodes"]} | frozen
    for n in res["graph"]["nodes"]:
        assert n["parent"] in ids, (n["id"], n["parent"])


def test_edges_reference_known_endpoints():
    res = bcg.build()
    frozen = _frozen_leaf_ids()
    ids = {n["id"] for n in res["graph"]["nodes"]} | frozen
    for e in res["graph"]["edges"]:
        assert e["src"] in ids and e["dst"] in ids, e


def test_prerequisite_subgraph_is_a_dag():
    res = bcg.build()
    pre = [(e["src"], e["dst"]) for e in res["graph"]["edges"] if e["kind"] == "prerequisite"]
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


def test_does_not_import_the_engine():
    bcg.build()
    offenders = [m for m in sys.modules if m == "anki" or m.startswith("anki.")]
    assert not offenders, f"the concept-graph builder must not import the Anki engine: {offenders}"
