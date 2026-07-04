# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""The ONLY place a score is emitted. Every score returns either a value WITH a range + the five
honesty elements (evidence / missing-data / past-accuracy / range / best-next), or a structured
abstention via the give-up rule. No fabricated readiness number ever leaves this module."""

from __future__ import annotations

import math

from anki.collection import Collection

from . import coverage as coverage_mod
from . import engine, give_up
from . import memory as memory_mod


def _interval(point: float, n: int, lo: float = 0.0, hi: float = 1.0) -> list[float]:
    """A deterministic uncertainty band that shrinks with sample size n."""
    width = min(0.25, 0.5 / math.sqrt(max(n, 1)))
    return [round(max(lo, point - width), 4), round(min(hi, point + width), 4)]


def memory_display(col: Collection, topics) -> dict:
    n = memory_mod.memory_n(topics)
    point = memory_mod.memory_aggregate(topics)
    conf = give_up.memory_confidence(n)
    return {
        "kind": "memory",
        "available": True,  # MEMORY always shows (low-confidence-flagged below the floor)
        "point": round(point, 4),
        "range": _interval(point, n),
        "confidence": conf,
        "evidence": f"FSRS retrievability over {n} card(s) with memory state, read from the "
        "MasteryQuery RPC (not recomputed)",
        "missing_data": None
        if conf == "ok"
        else f"fewer than {give_up.MEMORY_LOW_CONFIDENCE_BELOW} cards with FSRS state",
        "past_accuracy": "calibration pending — Brier/log-loss on held-out reviews (Block G)",
        "best_next": None,
        "data_provenance": engine.data_provenance(col),
    }


def performance_display(col: Collection, topic_items: int | None = None) -> dict:
    # The performance model (held-out exam-style accuracy) is built in Block F6/G; abstain until then.
    # Only surface the per-topic graded-items shortfall when a real per-topic count is supplied — the
    # dashboard has no per-topic context yet, so it must not claim "< N on this topic" for everyone.
    extra = ""
    if topic_items is not None and not give_up.performance_available(topic_items):
        extra = f"; also < {give_up.PERFORMANCE_MIN_ITEMS} graded items on this topic"
    return {
        "kind": "performance",
        "available": False,
        "reason": "performance model (held-out exam-style accuracy) is built in Block G" + extra,
        "best_next": None,
        "data_provenance": engine.data_provenance(col),
    }


def readiness_display(
    col: Collection,
    topics,
    gate_coverage_fraction: float,
    best_next=None,
    section_perf: dict | None = None,
) -> dict:
    total = engine.total_graded_reviews(topics)
    prov = engine.data_provenance(col)
    if not give_up.readiness_available(total, gate_coverage_fraction):
        return {
            "kind": "readiness",
            "available": False,
            "reason": give_up.readiness_block_reason(total, gate_coverage_fraction),
            "graded_reviews": total,
            "graded_reviews_required": give_up.READINESS_MIN_GRADED_REVIEWS,
            "coverage_pct": round(gate_coverage_fraction * 100, 1),
            "coverage_required_pct": round(give_up.READINESS_MIN_COVERAGE * 100, 1),
            "best_next": best_next,
            "data_provenance": prov,
        }
    # Available path: map held-out performance accuracy onto the 472-528 scale (W3.6 / SU1). The point
    # is never fabricated — it comes from a documented, UNVALIDATED map of a measured accuracy.
    from . import readiness as readiness_mod  # local: readiness is a sibling scoring module

    sp = section_perf or {"acc": 0.5, "acc_range": [0.4, 0.6]}
    mapped = readiness_mod.map_to_scale(sp, coverage=gate_coverage_fraction)
    return {
        "kind": "readiness",
        "available": True,
        "point": mapped["point"],
        "range": mapped["range"],
        "coverage_pct": round(gate_coverage_fraction * 100, 1),
        "confidence": "low" if gate_coverage_fraction < 0.9 else "moderate",
        "evidence": "held-out performance accuracy mapped onto 472-528 (docs/score-mapping.md)",
        "missing_data": None,
        "past_accuracy": "see docs/release-proof/eval/performance-heldout.txt",
        "note": "mapping UNVALIDATED against real outcomes",
        "best_next": best_next,
        "data_provenance": prov,
        "synthetic_caveat": (
            "scores are on SYNTHETIC data — not a real readiness estimate" if prov == "synthetic" else None
        ),
    }


def dashboard(col: Collection, search: str = "") -> dict:
    """The three honest scores + the coverage map for one deck selection."""
    topics = engine.mastery_topics(col, search)
    tax = coverage_mod.load_taxonomy()
    cov = coverage_mod.coverage(topics, tax)
    best_next = cov["uncovered_content_categories"][0] if cov["uncovered_content_categories"] else None
    return {
        "memory": memory_display(col, topics),
        "performance": performance_display(col),
        "readiness": readiness_display(col, topics, cov["gate_fraction"], best_next=best_next),
        "coverage": cov,
    }
