#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up: build the knowledge-graph sidecar (Block I / T-GRAPH).

A versioned JSON sidecar the 3D VIEW renders from. The FROZEN spine is 48 nodes (4 sections + 10
Foundational Concepts + 31 content categories + 3 CARS) built FROM docs/data/mcat_taxonomy.yaml (single
source). BENEATH the content categories, an ADDITIVE topic layer (Nexus outline grain, Decision 2026-07-01)
adds every AAMC-outline `topic` / `subtopic` node plus a verified topic-level `prerequisite` DAG and a few
`related` edges — a much denser, "every MCAT topic" graph. The spine's 31/34 coverage denominators are
untouched (topics are additive, structural, and carry NO deck path — their mastery rolls up from the
existing category decks; no fabricated per-topic numbers). `contains` hierarchy edges come free from the
parent links. Positions are baked deterministically (no live physics). Lives OUTSIDE collection.anki2 —
reads ONLY the taxonomy YAML and opens no collection (no schema bump, no engine import)."""

from __future__ import annotations

import json
import math
import os
from pathlib import Path

import yaml  # type: ignore[import-untyped]

# Golden ratio → the golden angle, for even Fibonacci-sphere placement of a parent's children.
_GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))
# Cluster radii: a topic shell around its content-category; subtopics in a smaller shell around their
# topic. The shell grows with the child count (via _shell_radius) so a dense category (many topics)
# spreads out instead of packing into a ball — key to "not a hairball" when a category is drilled.
TOPIC_RADIUS = 5.0
SUBTOPIC_RADIUS = 2.4


def _shell_radius(base: float, n: int) -> float:
    """Grow a cluster's radius with its child count so dense clusters breathe (capped)."""
    return base * min(1.9, 1.0 + 0.05 * max(0, n - 1))


def _fib_sphere(i: int, n: int, r: float) -> tuple[float, float, float]:
    """Deterministic offset of child `i` of `n` on a sphere of radius `r` (even golden-angle spread).

    A single child sits slightly off-axis (not on the pole) so it never overlaps its parent's label."""
    if n <= 1:
        return (r * 0.62, 0.0, r * 0.35)
    y = 1.0 - 2.0 * (i + 0.5) / n  # -1 .. 1 (polar height)
    rad = math.sqrt(max(0.0, 1.0 - y * y))
    theta = _GOLDEN_ANGLE * i
    return (r * math.cos(theta) * rad, r * y, r * math.sin(theta) * rad)

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
# The ADDITIVE topic layer (every AAMC-outline topic/subtopic + the verified topic prerequisite DAG).
# Kept in its own file so the FROZEN spine taxonomy (and its CI golden-set tests) stays pristine.
TOPICS = ROOT / "docs" / "data" / "mcat_topics.yaml"
OUT = ROOT / "graph" / "sidecar.json"
# Bundled copy the SvelteKit knowledge-graph route imports (vite inlines it at build).
TS_OUT = ROOT / "ts" / "lib" / "graph-sidecar.json"

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

    # Merge in the additive topic layer, if present (kept in a separate file — see TOPICS above).
    if TOPICS.exists():
        tl = yaml.safe_load(TOPICS.read_text(encoding="utf-8")) or {}
        tax["topics"] = tl.get("topics", []) or []
        tax["topic_prerequisites"] = tl.get("topic_prerequisites", []) or []
        tax["topic_related"] = tl.get("topic_related", []) or []

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
    # Record each FC's position within its section's sibling list at insertion time, keyed by the
    # unique FC id, so the angular index is identity-stable (no value-equality collision) and O(n)
    # — while leaving the node append order identical to the source `fcs` order.
    fc_by_sec: dict[str, list] = {}
    fc_pos: dict[str, int] = {}
    for fc in fcs:
        sib = fc_by_sec.setdefault(fc["section"], [])
        fc_pos[fc["id"]] = len(sib)
        sib.append(fc)
    for fc in fcs:
        sib = fc_by_sec[fc["section"]]
        j = fc_pos[fc["id"]]
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
    # Same identity-stable, order-preserving indexing as the FC loop above (keyed by unique leaf_id).
    group: dict[str, list] = {}
    leaf_pos: dict[str, int] = {}
    for leaf in leaves:
        key = leaf["fc"] if leaf["is_content_category"] else "CARS"
        sib = group.setdefault(key, [])
        leaf_pos[leaf["leaf_id"]] = len(sib)
        sib.append(leaf)
    for leaf in leaves:
        parent_id = leaf["fc"] if leaf["is_content_category"] else "CARS"
        sib = group[parent_id]
        j = leaf_pos[leaf["leaf_id"]]
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

    # Attach the deck path to each LEAF node so the VIEW can map live MasteryQuery topics
    # (keyed by deck_name, e.g. "MCAT::B-B::1A") onto sidecar nodes (keyed by leaf_id, e.g. "BB.1A").
    leaf_path = {leaf["leaf_id"]: leaf["path"] for leaf in leaves}
    for n in nodes:
        p = leaf_path.get(n["id"])
        if p is not None:
            n["path"] = p  # deck path for category/cars leaves only (section/fc/topics carry none)

    # ---- ADDITIVE topic layer (Nexus outline grain) ----------------------------------------------
    # Every AAMC-outline topic / subtopic beneath the content categories. Topics cluster on a sphere
    # around their content-category node; subtopics cluster around their topic. Structural only: no
    # deck path (mastery rolls UP from the category decks at render time — never fabricated per topic).
    topics = tax.get("topics", []) or []
    node_by_id = {n["id"]: n for n in nodes}
    for kind, radius in (("topic", TOPIC_RADIUS), ("subtopic", SUBTOPIC_RADIUS)):
        by_parent: dict[str, list] = {}
        for t in topics:
            if t.get("kind") == kind:
                by_parent.setdefault(t["parent"], []).append(t)
        for parent_id, sibs in by_parent.items():
            p = node_by_id.get(parent_id)
            if p is None:
                raise ValueError(f"{kind} '{sibs[0]['id']}' references unknown parent '{parent_id}'")
            shell = _shell_radius(radius, len(sibs))
            for i, t in enumerate(sibs):
                dx, dy, dz = _fib_sphere(i, len(sibs), shell)
                node = {
                    "id": t["id"], "label": t["name"], "kind": kind, "parent": parent_id,
                    "section": p["section"],  # inherit hue from the parent — always consistent
                    "x": round(p["x"] + dx, 2), "y": round(p["y"] + dy, 2), "z": round(p["z"] + dz, 2),
                }  # no deck path: topic/subtopic nodes are structural (mastery rolls up from category decks)
                nodes.append(node)
                node_by_id[t["id"]] = node

    edges: list[dict] = []
    for fc in fcs:
        edges.append({"src": fc["section"], "dst": fc["id"], "kind": "contains"})
    for leaf in leaves:
        parent_id = leaf["fc"] if leaf["is_content_category"] else "CARS"
        edges.append({"src": parent_id, "dst": leaf["leaf_id"], "kind": "contains"})
    edges += [{"src": a, "dst": b, "kind": "prerequisite"} for a, b in PREREQ_EDGES]
    edges += [{"src": a, "dst": b, "kind": "related"} for a, b in RELATED_EDGES]

    # Additive topic layer: containment (parent -> child), the verified topic prerequisite DAG, and
    # topic `related` links. Rationale/confidence live in the taxonomy YAML (provenance) but are NOT
    # emitted to the sidecar — the render only needs src/dst/kind, keeping the artifact lean.
    for t in topics:
        edges.append({"src": t["parent"], "dst": t["id"], "kind": "contains"})
    for e in (tax.get("topic_prerequisites", []) or []):
        edges.append({"src": e["src"], "dst": e["dst"], "kind": "prerequisite"})
    for e in (tax.get("topic_related", []) or []):
        edges.append({"src": e["a"], "dst": e["b"], "kind": "related"})

    sidecar = {
        "version": 1,
        "source": "docs/data/mcat_taxonomy.yaml",
        "node_count": len(nodes),
        "nodes": nodes,
        "edges": edges,
    }
    payload = json.dumps(sidecar, separators=(",", ":"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(payload, encoding="utf-8")
    TS_OUT.parent.mkdir(parents=True, exist_ok=True)
    TS_OUT.write_text(payload, encoding="utf-8")
    return sidecar


if __name__ == "__main__":
    sc = build()
    print(f"nodes={len(sc['nodes'])} edges={len(sc['edges'])} bytes={os.path.getsize(OUT)}")
