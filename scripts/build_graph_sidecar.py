#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up: build the knowledge-graph sidecar (Block I / T-GRAPH).

A versioned, <100KB JSON sidecar the 3D VIEW renders from — 48 nodes (4 sections + 10 Foundational
Concepts + 31 content categories + 3 CARS) built FROM docs/data/mcat_taxonomy.yaml (single source),
`contains` hierarchy edges, a curated `prerequisite` DAG, and a few `related` edges. Positions are baked
deterministically (no live physics). Lives OUTSIDE collection.anki2 — reads ONLY the taxonomy YAML and
opens no collection (no schema bump, no engine import)."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
OUT = ROOT / "graph" / "sidecar.json"

# Curated v1 prerequisite edges (directed; MUST be acyclic — topo-checked in the test). Flows
# chem -> biochem -> cell -> systems, physics -> systems, and the psych chain 6->7->8->9->10.
PREREQ_EDGES = [
    ("CP.4E", "CP.5B"), ("CP.5A", "CP.5B"), ("CP.5B", "CP.5D"), ("CP.5B", "CP.5E"),
    ("CP.5D", "BB.1A"), ("CP.5D", "BB.1D"), ("BB.1A", "BB.1D"), ("BB.1A", "BB.1B"),
    ("BB.1B", "BB.1C"), ("BB.1A", "BB.2A"), ("BB.2A", "BB.2C"), ("BB.2A", "BB.2B"),
    ("BB.2A", "BB.3A"), ("BB.3A", "BB.3B"), ("CP.4A", "CP.4B"), ("CP.4C", "BB.3A"),
    ("PS.6A", "PS.6B"), ("PS.6B", "PS.6C"), ("PS.6C", "PS.7A"), ("PS.7A", "PS.7B"),
    ("PS.7B", "PS.7C"), ("PS.7A", "PS.8A"), ("PS.8A", "PS.8B"), ("PS.8B", "PS.8C"),
    ("PS.8C", "PS.9A"), ("PS.9A", "PS.9B"), ("PS.9A", "PS.10A"),
]
RELATED_EDGES = [("CP.4A", "CP.4C"), ("BB.1D", "CP.5E")]


def build() -> dict:
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    sections = tax["sections"]
    fcs = tax["foundational_concepts"]
    leaves = tax["leaves"]

    nodes: list[dict] = []

    # Sections (galaxy centers).
    for i, s in enumerate(sections):
        ang = 2 * math.pi * i / len(sections)
        nodes.append({
            "id": s["abbrev"], "label": s["name"], "kind": "section", "parent": None,
            "section": s["abbrev"],
            "x": round(40 * math.cos(ang), 2), "y": round(40 * math.sin(ang), 2), "z": 0.0,
        })

    # Foundational Concepts (ringed around their section).
    fc_by_sec: dict[str, list] = {}
    for fc in fcs:
        fc_by_sec.setdefault(fc["section"], []).append(fc)
    for fc in fcs:
        sib = fc_by_sec[fc["section"]]
        j = sib.index(fc)
        sec = next(n for n in nodes if n["id"] == fc["section"])
        ang = 2 * math.pi * j / max(len(sib), 1)
        nodes.append({
            "id": fc["id"], "label": fc["id"], "kind": "fc", "parent": fc["section"],
            "section": fc["section"],
            "x": round(sec["x"] + 15 * math.cos(ang), 2),
            "y": round(sec["y"] + 15 * math.sin(ang), 2),
            "z": round(8 * math.sin(ang), 2),
        })

    # Leaves: content categories under their FC; CARS skills under the CARS section.
    group: dict[str, list] = {}
    for leaf in leaves:
        key = leaf["fc"] if leaf["is_content_category"] else "CARS"
        group.setdefault(key, []).append(leaf)
    for leaf in leaves:
        parent_id = leaf["fc"] if leaf["is_content_category"] else "CARS"
        sib = group[parent_id]
        j = sib.index(leaf)
        pnode = next(n for n in nodes if n["id"] == parent_id)
        ang = 2 * math.pi * j / max(len(sib), 1)
        nodes.append({
            "id": leaf["leaf_id"], "label": leaf["name"],
            "kind": "category" if leaf["is_content_category"] else "cars",
            "parent": parent_id, "section": leaf["section"],
            "x": round(pnode["x"] + 6 * math.cos(ang), 2),
            "y": round(pnode["y"] + 6 * math.sin(ang), 2),
            "z": round(4 * math.cos(ang), 2),
        })

    edges: list[dict] = []
    for fc in fcs:
        edges.append({"src": fc["section"], "dst": fc["id"], "kind": "contains"})
    for leaf in leaves:
        parent_id = leaf["fc"] if leaf["is_content_category"] else "CARS"
        edges.append({"src": parent_id, "dst": leaf["leaf_id"], "kind": "contains"})
    edges += [{"src": a, "dst": b, "kind": "prerequisite"} for a, b in PREREQ_EDGES]
    edges += [{"src": a, "dst": b, "kind": "related"} for a, b in RELATED_EDGES]

    sidecar = {
        "version": 1,
        "source": "docs/data/mcat_taxonomy.yaml",
        "node_count": len(nodes),
        "nodes": nodes,
        "edges": edges,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(sidecar, separators=(",", ":")), encoding="utf-8")
    return sidecar


if __name__ == "__main__":
    sc = build()
    print(f"nodes={len(sc['nodes'])} edges={len(sc['edges'])} bytes={os.path.getsize(OUT)}")
