# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""W9b/T9 — DOK level + the DOK1->DOK2 unlock predicate (Decision 35; §O1/O3).

DOK2 unlocks for a topic ONLY when BOTH hold (Ryan's locked decision):

  * **mastery_met** — reuses the give-up thresholds (one source of truth): FSRS retrievability >=
    the 0.90 "mastered" family AND >= 20 graded items AND a passed reworded variant (the §J1
    paraphrase keystone extended to the depth axis, §O4); and
  * **time_floor_met** — at least ~4-6 weeks elapsed since the topic's FIRST graded review, where
    "first review" is read from the **immutable revlog history** (min revlog.id, the engine's
    wall-clock), NEVER a client-settable start — so the floor cannot be shortcut by clock tampering.

Everything here is READ-ONLY over the engine (the mastery RPC + a revlog read) plus the additive
sidecar; it never writes a due date or bumps the schema (Decision 19). ``node_id`` is the leaf's
deck path (== taxonomy path), e.g. ``"MCAT::B-B::1A"``.
"""

from __future__ import annotations

from anki.collection import Collection

from scores import engine, give_up
from scores.telemetry import sidecar

# Tunable 4-6 weeks per Decision 35; 4 weeks (28d) is the default floor.
DOK2_TIME_FLOOR_DAYS = 28
# The 0.90 "mastered" retrievability family (shared with scores/memory + the graph glow threshold).
MASTERY_RETRIEVABILITY = 0.90


def _node_to_search(node_id: str) -> str:
    return f'deck:"{node_id}"'


def first_review_ms(col: Collection, node_id: str) -> int | None:
    """Earliest revlog event (ms epoch) over the node's cards — the time-floor anchor.

    Read from immutable revlog history; ``id_for_name`` is used (NOT ``id``) so a missing deck is
    never created as a side effect. Returns None when the topic has no reviews (or no deck).
    """
    did = col.decks.id_for_name(node_id)
    if did is None:
        return None
    return col.db.scalar(
        "select min(id) from revlog where cid in (select id from cards where did = ?)", did
    )


def variant_passed(col: Collection, node_id: str) -> bool:
    """True once a reworded/application variant for this node has been answered correctly (§O4/J1)."""
    return any(
        row["is_fresh_variant"] == 1 and row["correct"] == 1
        for row in sidecar.read_item_attempts(col, node_id=node_id)
    )


def mastery_met(col: Collection, node_id: str) -> bool:
    """DOK1 mastery: retrievability >= 0.90 AND >= 20 graded items AND a passed reworded variant.

    Reuses the give-up per-topic floor so there is ONE source of truth, never a drifting constant.
    """
    topics = engine.mastery_topics(col, _node_to_search(node_id))
    topic = next((t for t in topics if t.cards_with_state > 0), None)
    if topic is None:
        return False
    if topic.average_recall < MASTERY_RETRIEVABILITY:
        return False
    if topic.graded_reviews < give_up.PERFORMANCE_MIN_ITEMS:
        return False
    return variant_passed(col, node_id)


def time_floor_met(col: Collection, node_id: str, now_s: float) -> bool:
    """True once >= DOK2_TIME_FLOOR_DAYS have elapsed since the topic's first revlog event."""
    first = first_review_ms(col, node_id)
    if first is None:
        return False  # never started → never time-floor-met
    elapsed_s = now_s - (first / 1000.0)
    return elapsed_s >= DOK2_TIME_FLOOR_DAYS * 86400


def unlock_dok2(col: Collection, node_id: str, now_s: float) -> bool:
    """The locked gate: DOK2 unlocks only when mastery AND the time floor are BOTH met."""
    return mastery_met(col, node_id) and time_floor_met(col, node_id, now_s)
