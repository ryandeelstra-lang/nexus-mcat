#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up: build the COMPREHENSIVE knowledge-graph data artifact.

Unifies three real layers into one artifact (graph/graph_full.json):
  * the frozen spine — 4 sections + 10 Foundational Concepts + 31 content categories + 3 CARS
    (docs/data/mcat_taxonomy.yaml)
  * the deep concept graph — topics / subtopics / concepts with prereq + related edges
    (graph/concept_graph.json, keyed to the same leaves)
  * the deepest card layer — one+ exam-style question per concept (graph/cards_gen/cards_*.json)

Every node gets a `tier` (0 section .. 6 card) and an `appear` threshold in [0,1]: a consumer showing
nodes with `appear <= t` streams them in layer by layer, parents always before children, higher-yield
first. Positions are baked deterministically (Fibonacci-sphere clusters around each parent) — no live
physics. Read-only; opens no collection; imports no engine."""

from __future__ import annotations

import json
import math
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
CONCEPTS = ROOT / "graph" / "concept_graph.json"
CARDS_DIR = ROOT / "graph" / "cards_gen"
OUT = ROOT / "graph" / "graph_full.json"

_GOLDEN = math.pi * (3.0 - math.sqrt(5.0))

TIER = {"section": 0, "fc": 1, "category": 2, "cars": 2, "topic": 3, "subtopic": 4, "concept": 5, "card": 6}
# The slider band each tier streams in over. A tier finishes (mostly) before the next begins, so nodes
# arrive layer by layer as the slider moves. Section = 0 (always on -> the default 4-node graph).
BAND = {0: (0.0, 0.0), 1: (0.05, 0.12), 2: (0.12, 0.20), 3: (0.20, 0.36),
        4: (0.36, 0.54), 5: (0.54, 0.80), 6: (0.80, 1.0)}
# Cluster shell radius around each parent, by the CHILD's tier.
SHELL = {1: 15.0, 2: 6.0, 3: 3.2, 4: 1.7, 5: 0.9, 6: 0.42}
YIELD_RANK = {"high": 0, "medium": 1, "low": 2, None: 2}


def _fib(i: int, n: int, r: float) -> tuple[float, float, float]:
    if n <= 1:
        return (r * 0.6, 0.0, r * 0.35)
    y = 1.0 - 2.0 * (i + 0.5) / n
    rad = math.sqrt(max(0.0, 1.0 - y * y))
    th = _GOLDEN * i
    return (r * math.cos(th) * rad, r * y, r * math.sin(th) * rad)


def _shell(base: float, n: int) -> float:
    return base * min(2.2, 1.0 + 0.05 * max(0, n - 1))


def load_spine() -> tuple[list[dict], list[dict]]:
    """The 48-node spine as {id,label,kind,parent,section} + its containment (parent) links."""
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    nodes: list[dict] = []
    for s in tax["sections"]:
        nodes.append({"id": s["abbrev"], "label": s["name"], "kind": "section", "parent": None,
                      "section": s["abbrev"]})
    for fc in tax["foundational_concepts"]:
        nodes.append({"id": fc["id"], "label": fc["id"], "kind": "fc", "parent": fc["section"],
                      "section": fc["section"]})
    for leaf in tax["leaves"]:
        parent = leaf["fc"] if leaf["is_content_category"] else "CARS"
        nodes.append({"id": leaf["leaf_id"], "label": leaf["name"],
                      "kind": "category" if leaf["is_content_category"] else "cars",
                      "parent": parent, "section": leaf["section"]})
    return nodes, tax["leaves"]


def load_concepts() -> tuple[list[dict], list[dict]]:
    cg = json.loads(CONCEPTS.read_text(encoding="utf-8"))
    nodes = [{"id": n["id"], "label": n["label"], "kind": n["kind"], "parent": n["parent"],
              "section": n["section"], "yield": n.get("yield")} for n in cg["nodes"]]
    # keep only prerequisite + related edges (containment is derived from `parent`)
    edges = [e for e in cg["edges"] if e.get("kind") in ("prerequisite", "related")]
    return nodes, edges


def load_cards() -> list[dict]:
    cards: list[dict] = []
    if not CARDS_DIR.exists():
        return cards
    for f in sorted(CARDS_DIR.glob("cards_*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for c in data.get("cards", []):
            if c.get("id") and c.get("parent") and c.get("label"):
                cards.append({"id": c["id"], "label": c["label"], "kind": "card",
                              "parent": c["parent"], "section": None, "yield": None})
    return cards


def build() -> dict:
    spine, _leaves = load_spine()
    concept_nodes, concept_edges = load_concepts()
    card_nodes = load_cards()

    by_id: dict[str, dict] = {}
    order: list[dict] = []
    for n in spine + concept_nodes + card_nodes:
        if n["id"] in by_id:
            continue  # first definition wins (spine/concept ids never collide with cards)
        by_id[n["id"]] = n
        order.append(n)

    # Cards inherit their concept's section (for hue) once all nodes are indexed.
    for n in order:
        if n.get("section") is None and n.get("parent") in by_id:
            n["section"] = by_id[n["parent"]].get("section")

    # ---- subtree size (for revealing bigger clusters first within a tier) ----
    subtree = {n["id"]: 1 for n in order}
    for n in sorted(order, key=lambda m: -TIER.get(m["kind"], 0)):  # deepest first
        p = n.get("parent")
        if p in subtree:
            subtree[p] += subtree[n["id"]]

    # ---- appear threshold: band by tier, ordered within tier by (yield, -subtree, id) ----
    tier_members: dict[int, list[dict]] = {}
    for n in order:
        tier_members.setdefault(TIER.get(n["kind"], 5), []).append(n)
    appear: dict[str, float] = {}
    for tier, members in tier_members.items():
        lo, hi = BAND[tier]
        members.sort(key=lambda m: (YIELD_RANK.get(m.get("yield")), -subtree.get(m["id"], 1), m["id"]))
        k = max(len(members) - 1, 1)
        for i, m in enumerate(members):
            appear[m["id"]] = round(lo + (hi - lo) * (i / k), 4) if len(members) > 1 else lo
    # A child must never appear before its parent (bands guarantee it, but clamp to be safe).
    for n in order:
        p = n.get("parent")
        if p in appear:
            appear[n["id"]] = max(appear[n["id"]], appear[p] + 0.0005)

    # ---- baked positions: sections on a ring, everything else on a shell around its parent ----
    pos: dict[str, tuple[float, float, float]] = {}
    secs = [n for n in order if n["kind"] == "section"]
    for i, n in enumerate(secs):
        a = 2 * math.pi * i / max(len(secs), 1)
        pos[n["id"]] = (40 * math.cos(a), 40 * math.sin(a), 0.0)
    # place tier by tier so each parent is already positioned
    for tier in range(1, 7):
        kids_by_parent: dict[str, list[dict]] = {}
        for n in order:
            if TIER.get(n["kind"]) == tier:
                kids_by_parent.setdefault(n.get("parent"), []).append(n)
        for parent_id, kids in kids_by_parent.items():
            px, py, pz = pos.get(parent_id, (0.0, 0.0, 0.0))
            r = _shell(SHELL[tier], len(kids))
            for i, n in enumerate(kids):
                dx, dy, dz = _fib(i, len(kids), r)
                pos[n["id"]] = (px + dx, py + dy, pz + dz)

    out_nodes = []
    for n in order:
        x, y, z = pos.get(n["id"], (0.0, 0.0, 0.0))
        out_nodes.append({
            "id": n["id"], "label": n["label"], "kind": n["kind"],
            "parent": n.get("parent"), "section": n.get("section") or "B-B",
            "tier": TIER.get(n["kind"], 5), "appear": appear.get(n["id"], 1.0),
            "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
        })

    out_edges = [{"src": e["src"], "dst": e["dst"], "kind": e["kind"]}
                 for e in concept_edges if e["src"] in by_id and e["dst"] in by_id]

    # ---- BACKBONE edges: the interconnecting web between topics / categories / sections ------------
    # Topics aren't standalone, so we surface higher-level prerequisite links by AGGREGATING the real
    # concept-level prereqs up to the topic, category, and section altitudes (plus the curated category
    # DAG from the spine sidecar). These few (~1k) long-range edges are what the renderer draws at EVERY
    # zoom level, so the map reads as one connected constellation instead of isolated galaxies.
    import collections

    def _anc(nid: str, kinds: tuple[str, ...]) -> str | None:
        cur, g = nid, 0
        while cur and g < 16:
            nd = by_id.get(cur)
            if not nd:
                return None
            if nd["kind"] in kinds:
                return cur
            cur = nd.get("parent")
            g += 1
        return None

    CATK = ("category", "cars")
    sec_pairs: set = set()
    cat_pairs: set = set()
    topic_w: collections.Counter = collections.Counter()
    for e in concept_edges:
        if e["kind"] != "prerequisite":
            continue
        a, b = by_id.get(e["src"]), by_id.get(e["dst"])
        if not a or not b:
            continue
        if a.get("section") and b.get("section") and a["section"] != b["section"]:
            sec_pairs.add((a["section"], b["section"]))
        cs, cd = _anc(e["src"], CATK), _anc(e["dst"], CATK)
        if cs and cd and cs != cd:
            cat_pairs.add((cs, cd))
        ts, td = _anc(e["src"], ("topic",)), _anc(e["dst"], ("topic",))
        if ts and td and ts != td:
            topic_w[(ts, td)] += 1
    # the curated category prerequisite DAG (from the spine sidecar) — hand-verified cross links
    try:
        sc = json.loads((ROOT / "graph" / "sidecar.json").read_text(encoding="utf-8"))
        cat_ids = {n["id"] for n in order if n["kind"] in CATK}
        for e in sc.get("edges", []):
            if e.get("kind") == "prerequisite" and e["src"] in cat_ids and e["dst"] in cat_ids:
                cat_pairs.add((e["src"], e["dst"]))
    except (OSError, json.JSONDecodeError):
        pass

    seen_pair: set = set()
    backbone: list[dict] = []

    def _add_backbone(pairs) -> None:
        for a, b in pairs:
            if a == b or a not in by_id or b not in by_id:
                continue
            key = frozenset((a, b))
            if key in seen_pair:
                continue
            seen_pair.add(key)
            backbone.append({"src": a, "dst": b, "kind": "prerequisite"})

    _add_backbone(sec_pairs)
    _add_backbone(cat_pairs)
    # keep the strongest topic-topic links (by how many concept prereqs support them) — airy, not a hairball
    _add_backbone(p for p, _ in topic_w.most_common(1000))
    out_edges += backbone

    graph = {"version": 1, "source": "spine + concept_graph + cards_gen",
             "node_count": len(out_nodes), "edge_count": len(out_edges),
             "nodes": out_nodes, "edges": out_edges}
    payload = json.dumps(graph, separators=(",", ":"))
    OUT.write_text(payload, encoding="utf-8")
    return graph


if __name__ == "__main__":
    import collections
    g = build()
    kinds = collections.Counter(n["kind"] for n in g["nodes"])
    print(f"nodes={len(g['nodes'])} edges={len(g['edges'])} bytes={OUT.stat().st_size}")
    print("kinds:", dict(kinds))
