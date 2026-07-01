#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up: build + validate the DEEP MCAT concept graph (the Category-altitude layer).

This is the ADDITIVE leaf population that lives UNDERNEATH the frozen 48-node spine
(docs/14 §"Grain / size" — the Category altitude revealed on drill-down). It does NOT touch
the frozen taxonomy or graph/sidecar.json (those stay CI-green at exactly 48 nodes).

Inputs:
  graph/concepts/<LEAF>.json   one per AAMC content-category / CARS leaf (34 total). Each holds
                               a 3-level tree (topic > subtopic > concept) of nodes whose ids are
                               prefixed with the leaf id, plus intra-category prerequisite/related
                               edges and soft external_prereqs.
  graph/cross/cross_edges.json (optional) curated cross-category prerequisite edges (exact ids).

Outputs:
  graph/concept_graph.json         merged { nodes, edges } for offline analysis (PPR, DAG checks).
  graph/concepts/_index.json       per-leaf manifest the VIEW uses to lazy-load a drill-down.
  graph/concept_graph_report.json  build report: counts, dropped danglers, broken cycles, warnings.

Validation (fail-closed via the test): every node id is prefixed by + rolls up to exactly one of the
34 frozen leaves; every parent resolves; ids are globally unique; the prerequisite edges form a DAG.
The builder SANITIZES (drops dangling edges, breaks any cycle by removing the offending back-edge) and
REPORTS what it dropped — review the report; the test asserts the produced artifact is clean.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
CONCEPTS_DIR = ROOT / "graph" / "concepts"
CROSS = ROOT / "graph" / "cross" / "cross_edges.json"
OUT = ROOT / "graph" / "concept_graph.json"
INDEX = ROOT / "graph" / "concepts" / "_index.json"
REPORT = ROOT / "graph" / "concept_graph_report.json"


def frozen_leaves() -> dict[str, dict]:
    """The 34 frozen drill-down anchors, keyed by leaf_id (e.g. 'BB.1A')."""
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    return {
        leaf["leaf_id"]: {
            "section": leaf["section"],
            "is_content_category": leaf["is_content_category"],
            "name": leaf["name"],
        }
        for leaf in tax["leaves"]
    }


def difflib_best(hint: str, candidates: list[tuple[str, str]]) -> str | None:
    """Resolve a soft external_prereq hint to the best (id, label) match in a leaf."""
    import difflib

    if not candidates:
        return None
    labels = [c[1] for c in candidates]
    match = difflib.get_close_matches(hint, labels, n=1, cutoff=0.55)
    if match:
        for cid, clabel in candidates:
            if clabel == match[0]:
                return cid
    return None


def build() -> dict:
    leaves = frozen_leaves()
    report: dict = {
        "missing_files": [],
        "malformed_files": [],
        "dropped_dangling_edges": [],
        "broken_cycle_edges": [],
        "duplicate_ids": [],
        "resolved_external": 0,
        "unresolved_external": [],
        "warnings": [],
    }

    nodes: dict[str, dict] = {}      # id -> node
    node_by_leaf: dict[str, list] = {}
    edges: list[dict] = []
    raw_external: list[dict] = []

    # ---- load every category file ----
    for leaf_id in leaves:
        fp = CONCEPTS_DIR / f"{leaf_id}.json"
        if not fp.exists():
            report["missing_files"].append(leaf_id)
            continue
        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            report["malformed_files"].append({"leaf": leaf_id, "error": str(e)})
            continue

        sec = leaves[leaf_id]["section"]
        local_ids: list = []
        for n in data.get("nodes", []):
            nid = n.get("id", "")
            if not nid.startswith(leaf_id + "."):
                report["warnings"].append(f"{leaf_id}: node id not prefixed by leaf: {nid!r}")
                continue
            if nid in nodes:
                report["duplicate_ids"].append(nid)
                continue
            nodes[nid] = {
                "id": nid,
                "label": n.get("label", nid),
                "kind": n.get("kind", "concept"),
                "parent": n.get("parent", leaf_id),
                "leaf": leaf_id,
                "section": sec,
                "summary": n.get("summary", ""),
                "yield": n.get("yield"),
            }
            local_ids.append(nid)
        node_by_leaf[leaf_id] = local_ids

        for e in data.get("prerequisites", []):
            edges.append({"src": e["src"], "dst": e["dst"], "kind": "prerequisite"})
        for e in data.get("related", []):
            edges.append({"src": e["src"], "dst": e["dst"], "kind": "related"})
        for e in data.get("external_prereqs", []):
            raw_external.append({**e, "_in_leaf": leaf_id})

    valid_ids = set(nodes) | set(leaves)  # leaf ids are valid parents (spine attach point)

    # ---- fix parents that don't resolve (reattach to the leaf) ----
    for n in nodes.values():
        if n["parent"] not in valid_ids:
            report["warnings"].append(f"{n['id']}: parent {n['parent']!r} unresolved -> reattached to {n['leaf']}")
            n["parent"] = n["leaf"]
        # add containment edge parent -> child
        edges.append({"src": n["parent"], "dst": n["id"], "kind": "contains"})

    # ---- resolve soft external prerequisites to concrete ids ----
    cand_by_leaf = {
        lf: [(nid, nodes[nid]["label"]) for nid in ids]
        for lf, ids in node_by_leaf.items()
    }
    for e in raw_external:
        dst = e.get("dst")
        from_leaf = e.get("from_leaf")
        hint = e.get("concept_hint", "")
        if dst not in nodes:
            report["unresolved_external"].append({**e, "why": "dst not a known node"})
            continue
        src = difflib_best(hint, cand_by_leaf.get(from_leaf, []))
        if src:
            edges.append({"src": src, "dst": dst, "kind": "prerequisite"})
            report["resolved_external"] += 1
        else:
            report["unresolved_external"].append({**e, "why": "no match in from_leaf"})

    # ---- load curated cross-category edges ----
    if CROSS.exists():
        try:
            cross = json.loads(CROSS.read_text(encoding="utf-8"))
            for e in cross.get("edges", cross if isinstance(cross, list) else []):
                edges.append({"src": e["src"], "dst": e["dst"], "kind": "prerequisite"})
        except Exception as e:  # noqa: BLE001
            report["warnings"].append(f"cross_edges.json unreadable: {e}")

    # ---- drop dangling edges (endpoints must be real nodes or frozen leaves) ----
    clean: list[dict] = []
    for e in edges:
        if e["src"] in valid_ids and e["dst"] in valid_ids:
            clean.append(e)
        else:
            report["dropped_dangling_edges"].append(e)
    edges = clean

    # ---- break cycles in the prerequisite subgraph (drop offending back-edges) ----
    pre = [(e["src"], e["dst"]) for e in edges if e["kind"] == "prerequisite"]
    adj: dict[str, list[str]] = {}
    for a, b in pre:
        adj.setdefault(a, []).append(b)
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {}
    back_edges: set[tuple[str, str]] = set()

    def dfs(u: str) -> None:
        color[u] = GRAY
        for v in adj.get(u, []):
            if color.get(v, WHITE) == WHITE:
                dfs(v)
            elif color.get(v) == GRAY:
                back_edges.add((u, v))  # u->v closes a cycle
        color[u] = BLACK

    sys.setrecursionlimit(100000)
    for node in list(adj):
        if color.get(node, WHITE) == WHITE:
            dfs(node)

    if back_edges:
        report["broken_cycle_edges"] = [{"src": a, "dst": b} for a, b in sorted(back_edges)]
        edges = [
            e for e in edges
            if not (e["kind"] == "prerequisite" and (e["src"], e["dst"]) in back_edges)
        ]

    # ---- write outputs ----
    node_list = sorted(nodes.values(), key=lambda n: n["id"])
    graph = {
        "version": 1,
        "source": "graph/concepts/*.json (deep concept layer; spine stays in sidecar.json)",
        "node_count": len(node_list),
        "edge_count": len(edges),
        "nodes": node_list,
        "edges": edges,
    }
    OUT.write_text(json.dumps(graph, separators=(",", ":")), encoding="utf-8")

    manifest = {
        "version": 1,
        "leaves": {
            leaf_id: {
                "section": leaves[leaf_id]["section"],
                "name": leaves[leaf_id]["name"],
                "file": f"concepts/{leaf_id}.json",
                "node_count": len(node_by_leaf.get(leaf_id, [])),
            }
            for leaf_id in leaves
        },
        "total_concept_nodes": len(node_list),
    }
    INDEX.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    counts_by_kind: dict[str, int] = {}
    for n in node_list:
        counts_by_kind[n["kind"]] = counts_by_kind.get(n["kind"], 0) + 1
    counts_by_section: dict[str, int] = {}
    for n in node_list:
        counts_by_section[n["section"]] = counts_by_section.get(n["section"], 0) + 1

    return {
        "graph": graph,
        "report": report,
        "counts_by_kind": counts_by_kind,
        "counts_by_section": counts_by_section,
        "node_by_leaf": {k: len(v) for k, v in node_by_leaf.items()},
    }


if __name__ == "__main__":
    res = build()
    g = res["graph"]
    r = res["report"]
    print(f"nodes={g['node_count']} edges={g['edge_count']}")
    print(f"by kind: {res['counts_by_kind']}")
    print(f"by section: {res['counts_by_section']}")
    print(
        "report: "
        f"missing={len(r['missing_files'])} malformed={len(r['malformed_files'])} "
        f"dangling_dropped={len(r['dropped_dangling_edges'])} cycles_broken={len(r['broken_cycle_edges'])} "
        f"dup_ids={len(r['duplicate_ids'])} ext_resolved={r['resolved_external']} "
        f"ext_unresolved={len(r['unresolved_external'])}"
    )
    if r["missing_files"]:
        print("MISSING:", r["missing_files"])
    if r["malformed_files"]:
        print("MALFORMED:", [m["leaf"] for m in r["malformed_files"]])
