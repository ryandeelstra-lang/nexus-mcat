# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""The give-up rule (tier-1: protects the 'no fabricated/misleading readiness number' auto-fail gate).

Thresholds (03 §F2 + the locked decision; these SUPERSEDE any stale 200/50 framing):
  READINESS abstains unless >= 1,000 graded reviews (revlog ROW count, not distinct cards)
            AND >= 75% of the 31 AAMC content categories covered.
  PERFORMANCE abstains on a topic with < 20 graded items.
  MEMORY is always shown, flagged low-confidence below a small per-collection floor.
"""

from __future__ import annotations

READINESS_MIN_GRADED_REVIEWS = 1000  # revlog answer EVENTS, not distinct cards
READINESS_MIN_COVERAGE = 0.75  # of the 31 content categories (gate denominator)
PERFORMANCE_MIN_ITEMS = 20  # per-topic graded items
MEMORY_LOW_CONFIDENCE_BELOW = 10  # cards-with-state below which memory is low-confidence


def readiness_available(total_graded_reviews: int, gate_coverage_fraction: float) -> bool:
    return (
        total_graded_reviews >= READINESS_MIN_GRADED_REVIEWS
        and gate_coverage_fraction >= READINESS_MIN_COVERAGE
    )


def readiness_block_reason(total_graded_reviews: int, gate_coverage_fraction: float) -> str:
    reasons = []
    if total_graded_reviews < READINESS_MIN_GRADED_REVIEWS:
        reasons.append(
            f"only {total_graded_reviews} graded reviews (need >= {READINESS_MIN_GRADED_REVIEWS})"
        )
    if gate_coverage_fraction < READINESS_MIN_COVERAGE:
        reasons.append(
            f"only {gate_coverage_fraction:.0%} of content categories covered "
            f"(need >= {READINESS_MIN_COVERAGE:.0%})"
        )
    return "; ".join(reasons) or "below the readiness floor"


def performance_available(topic_items: int) -> bool:
    return topic_items >= PERFORMANCE_MIN_ITEMS


def memory_confidence(cards_with_state: int) -> str:
    return "low" if cards_with_state < MEMORY_LOW_CONFIDENCE_BELOW else "ok"
