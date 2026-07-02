# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Memory model — FSRS retrievability of studied material, CONSUMED from the MasteryQuery RPC
(never recomputed). Memory answers 'how well is what you've studied remembered right now?'."""

from __future__ import annotations


def memory_by_topic(topics) -> dict[str, float]:
    """Per-topic average recall, only for topics that carry FSRS state."""
    return {t.deck_name: t.average_recall for t in topics if t.cards_with_state > 0}


def memory_n(topics) -> int:
    """Number of cards with FSRS memory state (the recall denominator)."""
    return sum(t.cards_with_state for t in topics)


def memory_aggregate(topics) -> float:
    """cards-with-state-weighted mean of per-topic average recall (0.0 if nothing has state)."""
    num = sum(t.average_recall * t.cards_with_state for t in topics if t.cards_with_state > 0)
    den = memory_n(topics)
    return (num / den) if den else 0.0
