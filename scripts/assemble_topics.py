#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up (Nexus): assemble the additive topic layer from parallel-agent YAML fragments.

Reads the per-Foundational-Concept fragments under docs/data/topics/ (gen_*.yaml from the generation
wave, and/or verified_*.yaml from the consensus wave), flattens topics/subtopics, resolves
cross-category prerequisite HINTS to real ids, dedupes, and keeps a MAXIMAL ACYCLIC prerequisite subset
(greedy, preferring higher-confidence edges) so the sidecar's DAG invariant can never be violated.
Writes docs/data/mcat_topics.yaml. Deterministic; opens no collection; imports no engine."""

from __future__ import annotations

import argparse
import difflib
import glob
import sys
from pathlib import Path

import yaml  # type: ignore[import-untyped]

ROOT = Path(__file__).resolve().parents[1]
TOPICS_DIR = ROOT / "docs" / "data" / "topics"
TAXONOMY = ROOT / "docs" / "data" / "mcat_taxonomy.yaml"
OUT = ROOT / "docs" / "data" / "mcat_topics.yaml"

SECTION_BY_PREFIX = {"BB": "B-B", "CP": "C-P", "PS": "P-S", "CARS": "CARS"}
CONF_RANK = {"high": 3, "medium": 2, "low": 1}


def _section_of(node_id: str) -> str:
    return SECTION_BY_PREFIX.get(node_id.split(".")[0], "B-B")


def load_leaf_ids() -> set[str]:
    tax = yaml.safe_load(TAXONOMY.read_text(encoding="utf-8"))
    return {leaf["leaf_id"] for leaf in tax["leaves"]}


def load_fragments(patterns: list[str]) -> list[tuple[str, dict]]:
    files: list[str] = []
    for pat in patterns:
        files += sorted(glob.glob(str(TOPICS_DIR / pat)))
    frags: list[tuple[str, dict]] = []
    for f in files:
        try:
            data = yaml.safe_load(Path(f).read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:  # a malformed fragment shouldn't sink the whole assembly
            print(f"[skip] {f}: YAML error {exc}", file=sys.stderr)
            continue
        if isinstance(data, dict):
            frags.append((f, data))
    return frags


def collect_topics(
    frags: list[tuple[str, dict]],
    leaf_ids: set[str],
) -> tuple[dict[str, dict], dict[tuple[str, str], str], dict[str, list[str]], list[str]]:
    topics: dict[str, dict] = {}
    name_index: dict[tuple[str, str], str] = {}  # (category_id, lower name) -> topic id
    by_category: dict[str, list[str]] = {}
    problems: list[str] = []
    for fname, data in frags:
        for cat in (data.get("categories") or []):
            cid = cat.get("id")
            if cid not in leaf_ids:
                problems.append(f"{Path(fname).name}: unknown category id {cid!r}")
                continue
            sec = _section_of(cid)
            for t in (cat.get("topics") or []):
                tid, tname = t.get("id"), (t.get("name") or "").strip()
                if not tid or not tname:
                    problems.append(f"{Path(fname).name}: topic missing id/name under {cid}")
                    continue
                if not str(tid).startswith(cid + ".T"):
                    problems.append(f"{Path(fname).name}: topic id {tid!r} not under {cid}")
                    continue
                if tid in topics:
                    problems.append(f"duplicate topic id {tid!r}")
                    continue
                topics[tid] = {"id": tid, "name": tname, "kind": "topic", "parent": cid, "section": sec}
                by_category.setdefault(cid, []).append(tid)
                name_index[(cid, tname.lower())] = tid
                for s in (t.get("subtopics") or []):
                    sid, sname = s.get("id"), (s.get("name") or "").strip()
                    if not sid or not sname:
                        problems.append(f"{Path(fname).name}: subtopic missing id/name under {tid}")
                        continue
                    if not str(sid).startswith(str(tid) + ".S"):
                        problems.append(f"{Path(fname).name}: subtopic id {sid!r} not under {tid}")
                        continue
                    if sid in topics:
                        problems.append(f"duplicate subtopic id {sid!r}")
                        continue
                    topics[sid] = {"id": sid, "name": sname, "kind": "subtopic", "parent": tid, "section": sec}
    return topics, name_index, by_category, problems


def resolve_hint(
    hint: str,
    topics: dict[str, dict],
    name_index: dict[tuple[str, str], str],
    by_category: dict[str, list[str]],
) -> str | None:
    """Resolve a "CATEGORY_ID: topic name" hint to a real topic id (exact → substring → fuzzy)."""
    if not hint or ":" not in hint:
        # maybe it's already an exact id
        return hint if hint in topics else None
    cat, name = hint.split(":", 1)
    cat, name = cat.strip(), name.strip().lower()
    if (cat, name) in name_index:
        return name_index[(cat, name)]
    cand = by_category.get(cat, [])
    for tid in cand:
        low = topics[tid]["name"].lower()
        if name and (name in low or low in name):
            return tid
    names = [topics[tid]["name"].lower() for tid in cand]
    match = difflib.get_close_matches(name, names, n=1, cutoff=0.6)
    if match:
        return cand[names.index(match[0])]
    return None


def add_prereq(prereqs, topics, problems, src, dst, rat, conf) -> None:
    """Insert a prerequisite edge with dedupe (keep the higher-confidence rationale). Shared by the
    generation-fragment pass and the verification (`add`) pass."""
    if not src or not dst or src == dst:
        return
    if src not in topics or dst not in topics:
        problems.append(f"prereq endpoint missing: {src} -> {dst}")
        return
    conf = conf if conf in CONF_RANK else "medium"
    key = (src, dst)
    if key not in prereqs or CONF_RANK[conf] > CONF_RANK[prereqs[key]["confidence"]]:
        prereqs[key] = {"rationale": (rat or "").strip()[:100], "confidence": conf}


def apply_verified(
    prereqs: dict[tuple[str, str], dict],
    topics: dict[str, dict],
    problems: list[str],
) -> tuple[int, int, list, int]:
    """Apply the Wave-2 consensus: drop wrong edges, add verifier-endorsed (esp. cross-domain) edges."""
    vfrags = load_fragments(["verified_*.yaml"])
    dropped = added = 0
    flags: list = []
    for fname, data in vfrags:
        for pair in (data.get("drop") or []):
            if isinstance(pair, dict):
                key = (pair.get("src"), pair.get("dst"))
            elif isinstance(pair, (list, tuple)) and len(pair) == 2:
                key = (pair[0], pair[1])
            else:
                continue
            if key in prereqs:
                del prereqs[key]
                dropped += 1
        for e in (data.get("add") or []):
            before = len(prereqs)
            add_prereq(prereqs, topics, problems, e.get("src"), e.get("dst"),
                       e.get("rationale"), e.get("confidence"))
            if len(prereqs) > before:
                added += 1
        for fl in (data.get("topics_flag") or []):
            flags.append((Path(fname).name, fl))
    return dropped, added, flags, len(vfrags)


def collect_edges(
    frags: list[tuple[str, dict]],
    topics: dict[str, dict],
    name_index: dict[tuple[str, str], str],
    by_category: dict[str, list[str]],
) -> tuple[dict[tuple[str, str], dict], dict[frozenset, str], list[str]]:
    prereqs: dict[tuple[str, str], dict] = {}
    related: dict[frozenset, str] = {}
    problems: list[str] = []

    def add_pre(src, dst, rat, conf) -> None:
        add_prereq(prereqs, topics, problems, src, dst, rat, conf)

    for fname, data in frags:
        for e in (data.get("prerequisites") or []):
            add_pre(e.get("src"), e.get("dst"), e.get("rationale"), e.get("confidence"))
        for e in (data.get("cross_prerequisites") or []):
            src, dst = e.get("src"), e.get("dst")
            if not src and e.get("src_hint"):
                src = resolve_hint(e["src_hint"], topics, name_index, by_category)
            if not dst and e.get("dst_hint"):
                dst = resolve_hint(e["dst_hint"], topics, name_index, by_category)
            if src and dst:
                add_pre(src, dst, e.get("rationale"), e.get("confidence"))
            else:
                problems.append(f"{Path(fname).name}: unresolved cross hint {e}")
        for e in (data.get("related") or []):
            a, b = e.get("a"), e.get("b")
            if a in topics and b in topics and a != b:
                related[frozenset((a, b))] = (e.get("rationale") or "").strip()[:100]

    return prereqs, related, problems


def acyclic_subset(prereqs: dict[tuple[str, str], dict]) -> tuple[list[tuple], list[tuple]]:
    """Greedy maximal acyclic subset: add edges high→low confidence, skip any that would close a cycle."""
    order = sorted(prereqs.items(), key=lambda kv: (-CONF_RANK[kv[1]["confidence"]], kv[0]))
    adj: dict[str, set[str]] = {}

    def reachable(a: str, b: str) -> bool:
        stack, seen = [a], set()
        while stack:
            x = stack.pop()
            if x == b:
                return True
            if x in seen:
                continue
            seen.add(x)
            stack.extend(adj.get(x, ()))
        return False

    kept: list[tuple] = []
    dropped: list[tuple] = []
    for (src, dst), meta in order:
        if reachable(dst, src):  # adding src->dst would close a cycle
            dropped.append((src, dst))
            continue
        adj.setdefault(src, set()).add(dst)
        kept.append((src, dst, meta))
    return kept, dropped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--patterns", nargs="+", default=["gen_*.yaml"],
                    help="glob(s) under docs/data/topics/ to assemble from")
    args = ap.parse_args()

    leaf_ids = load_leaf_ids()
    frags = load_fragments(args.patterns)
    if not frags:
        print(f"no fragments matched {args.patterns} in {TOPICS_DIR}", file=sys.stderr)
        sys.exit(1)

    topics, name_index, by_category, p1 = collect_topics(frags, leaf_ids)
    prereqs, related, p2 = collect_edges(frags, topics, name_index, by_category)
    # Wave-2 consensus: independent per-section verifiers drop wrong edges and add cross-domain ones.
    v_dropped, v_added, v_flags, n_verified = apply_verified(prereqs, topics, p2)
    kept, dropped = acyclic_subset(prereqs)

    out = {
        "version": 1,
        "source": "assembled from docs/data/topics/ by scripts/assemble_topics.py",
        "topics": list(topics.values()),
        "topic_prerequisites": [
            {"src": s, "dst": d, "rationale": m["rationale"], "confidence": m["confidence"]}
            for (s, d, m) in kept
        ],
        "topic_related": [
            {"a": sorted(k)[0], "b": sorted(k)[1], "rationale": r} for k, r in sorted(
                related.items(), key=lambda kv: sorted(kv[0]))
        ],
    }
    header = (
        "# GENERATED by scripts/assemble_topics.py — do not hand-edit.\n"
        "# The additive Nexus topic layer: every AAMC-outline topic/subtopic + the verified\n"
        "# topic-level prerequisite DAG. Consumed by scripts/build_graph_sidecar.py.\n"
    )
    OUT.write_text(
        header + yaml.safe_dump(out, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8",
    )

    kinds: dict[str, int] = {}
    for t in topics.values():
        kinds[t["kind"]] = kinds.get(t["kind"], 0) + 1
    cats_covered = len(by_category)
    print(
        f"categories_covered={cats_covered}/34 topics={kinds.get('topic', 0)} "
        f"subtopics={kinds.get('subtopic', 0)} prereqs_kept={len(kept)} "
        f"prereqs_dropped_for_cycles={len(dropped)} related={len(related)}"
    )
    print(
        f"verification: files={n_verified} edges_dropped={v_dropped} edges_added={v_added} "
        f"topics_flagged={len(v_flags)}"
    )
    for fn, fl in v_flags[:40]:
        print(f"  flag [{fn}]: {fl}", file=sys.stderr)
    problems = p1 + p2
    if problems:
        print(f"[{len(problems)} problems]", file=sys.stderr)
        for pr in problems[:50]:
            print("  -", pr, file=sys.stderr)


if __name__ == "__main__":
    main()
