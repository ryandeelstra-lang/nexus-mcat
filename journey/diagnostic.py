# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""W7b — broad diagnostic item selection (the FLOOR) + answer capture (Decision 34; §N3/N6).

This is the compromise-hierarchy FLOOR for the one broad adaptive ~60-90 min diagnostic: a
**deterministic, breadth-first, section-interleaved** plan built on the EXISTING engine via indexed
search (`is:new`) — no Rust change, no card loading. It guarantees breadth (every content-bearing
leaf is reached, all 4 sections interleaved so none drags) within a bounded item budget.

The adaptive layer (spend remaining budget on the most-uncertain categories from running
performance) and the `DiagnosticSelect` Rust RPC (a 50k-deck perf optimization that avoids the
per-leaf searches) layer on top of this floor; the floor already seeds the map honestly.

`record_diagnostic_answer` writes ONLY to the `scores.telemetry` sidecar (mode='diagnostic') — never
the collection — so item capture is additive/read-only (Decision 19).
"""

from __future__ import annotations

from anki.collection import Collection

from scores import coverage
from scores.telemetry import sidecar

# Fixed section cycle for the round-robin interleave (so consecutive picks differ in section).
SECTION_CYCLE = ("C-P", "CARS", "B-B", "P-S")


def _leaf_candidates(col: Collection, path: str) -> list[int]:
    """Card ids in a leaf's subdeck, deterministic: unseen (is:new) first, then seen, each by id."""
    unseen = sorted(int(c) for c in col.find_cards(f'deck:"{path}" is:new'))
    seen = sorted(int(c) for c in col.find_cards(f'deck:"{path}" -is:new'))
    return unseen + seen


def _section_stream(leaf_lists: list[list[int]]) -> list[int]:
    """Round-robin across a section's leaves (breadth-first within the section)."""
    stream: list[int] = []
    pointers = [0] * len(leaf_lists)
    progressing = True
    while progressing:
        progressing = False
        for i, lst in enumerate(leaf_lists):
            if pointers[i] < len(lst):
                stream.append(lst[pointers[i]])
                pointers[i] += 1
                progressing = True
    return stream


def diagnostic_plan(col: Collection, *, max_items: int = 90) -> list[int]:
    """An ordered list of card ids for the diagnostic — breadth-first, section-interleaved,
    deterministic, capped at ``max_items``."""
    tax = coverage.load_taxonomy()
    by_section: dict[str, list[list[int]]] = {s: [] for s in SECTION_CYCLE}
    for leaf in tax["leaves"]:
        section = leaf["section"]
        if section not in by_section:
            continue
        cands = _leaf_candidates(col, leaf["path"])
        if cands:
            by_section[section].append(cands)

    streams = {s: _section_stream(by_section[s]) for s in SECTION_CYCLE}

    # Interleave the section streams round-robin → broad coverage early, no section dragging.
    plan: list[int] = []
    idx = {s: 0 for s in SECTION_CYCLE}
    progressing = True
    while len(plan) < max_items and progressing:
        progressing = False
        for s in SECTION_CYCLE:
            if idx[s] < len(streams[s]):
                plan.append(streams[s][idx[s]])
                idx[s] += 1
                progressing = True
                if len(plan) >= max_items:
                    break
    return plan


def record_diagnostic_answer(
    col: Collection,
    *,
    node_id: str,
    correct: bool,
    chosen_distractor_id: str | None = None,
    total_ms: int | None = None,
    revlog_id: int | None = None,
) -> int | None:
    """Capture one diagnostic answer to the sidecar (mode='diagnostic'). Additive/read-only."""
    return sidecar.record_item_attempt(
        col,
        mode=sidecar.MODE_DIAGNOSTIC,
        node_id=node_id,
        correct=correct,
        total_ms=total_ms,
        chosen_distractor_id=chosen_distractor_id,
        is_fresh_variant=False,
        revlog_id=revlog_id,
    )
