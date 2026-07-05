# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Frozen design constants for the §8 ablation — the code mirror of README.md §2-§5.

Every value here was committed BEFORE the first simulation run (commit 034f44e33).
Do not tune any of them after seeing results (docs/04-PLAN.md: auto-fail).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

MASTER_SEED = 20260705

# Pre-registration provenance (cited in the report).
PREREG_PLAN_COMMIT = "4605174"  # planning repo, 2026-06-30: hypothesis/metric/criterion
PREREG_FREEZE_COMMIT = "034f44e33"  # this branch: confusability range + constants

HYPOTHESIS = (
    "Interleaving related MCAT topics (Random order) yields higher held-out "
    "mixed-topic quiz accuracy than blocking (DeckThenDay) at an equal "
    "study-time budget."
)
FAILURE_CRITERION = (
    "Failed if FULL ≤ ABLATION at the same budget; CI overlapping zero = "
    "no effect, reported honestly."
)

# Frozen confusability range (README §2; literature-cited endpoints).
CONFUSABILITY_GRID = [0.0, 0.2, 0.4, 0.6]

# World: 8 topics in 4 confusable pairs, adjacent decks (generous to blocking).
TOPICS = 8
PAIRS = [(0, 1), (2, 3), (4, 5), (6, 7)]
CARDS_PER_TOPIC = 12
QUIZ_PER_TOPIC = 5

# Study schedule.
DAYS = 14
BUDGET_SECS_PER_DAY = 3600
COST_SUCCESS_SECS = 12
COST_FAILURE_SECS = 25

# Learner model.
P0_FIRST_EXPOSURE = 0.30
GUESS_FLOOR = 0.25
ETA_DISCRIMINATION = 0.02

# Statistics.
LEARNERS = 200
BOOTSTRAP_RESAMPLES = 10000
NULL_EQUIVALENCE_BOUND = 0.01  # |paired diff| at kappa=0 (README §5)

# Deterministic timestamp anchor: 2026-01-01 10:00:00 UTC. All simulated
# history is stamped relative to this fixed constant so revlog ids, card mods,
# and FSRS elapsed times are identical across arms AND across reruns (the
# engine's Random review order hashes fnvhash(id, mod)).
BASE_EPOCH_S = 1767261600
NOTE_ID_BASE_MS = BASE_EPOCH_S * 1000
CARD_ID_BASE_MS = NOTE_ID_BASE_MS + 10_000_000

_PARTNER = {a: b for a, b in PAIRS} | {b: a for a, b in PAIRS}
_PAIR_OF = {t: (min(t, _PARTNER[t]), max(t, _PARTNER[t])) for t in _PARTNER}


def partner_topic(topic: int) -> int:
    return _PARTNER[topic]


def pair_of(topic: int) -> tuple[int, int]:
    return _PAIR_OF[topic]


# Decision 4: the feature under ablation is EXACTLY these two deck-config
# fields (schema11 keys / proto enum values). PLAIN = untouched upstream
# defaults. Everything else is identical in every arm.
_ARM_CONFIGS = {
    "FULL": {"reviewOrder": 8, "newGatherPriority": 4},  # Random / RandomCards
    "ABLATION": {"reviewOrder": 2, "newGatherPriority": 0},  # DeckThenDay / Deck
    "PLAIN": {"reviewOrder": 0, "newGatherPriority": 0},  # upstream defaults
}
ARMS = ("FULL", "ABLATION", "PLAIN")

# Upstream defaults shared (and untouched) across all arms, echoed for the
# arm-isolation assertion + the report.
_SHARED_DEFAULTS = {
    "newPerDay": 20,
    "revPerDay": 200,
    "learnSteps": (1.0, 10.0),
}


def arm_deck_config(arm: str) -> dict:
    return {**_SHARED_DEFAULTS, **_ARM_CONFIGS[arm]}


@dataclass(frozen=True)
class QuizItem:
    topic: int
    idx: int

    @property
    def item_id(self) -> str:
        return f"quiz:T{self.topic:02d}:{self.idx}"


def quiz_items() -> list[QuizItem]:
    """Held-out mixed-topic quiz items — synthetic per-topic probes, disjoint
    from the study cards by construction (they are not cards at all)."""
    return [QuizItem(t, i) for t in range(TOPICS) for i in range(QUIZ_PER_TOPIC)]


def u01(*key: object) -> float:
    """Deterministic uniform draw in [0,1) from a SHA-256 of the key parts.

    Common-random-numbers seam: every stochastic learner decision hashes
    (MASTER_SEED, purpose, learner, card/item, rep) — identical across arms.
    """
    joined = "|".join(str(k) for k in key)
    digest = hashlib.sha256(joined.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def discrimination(n_contrast: int) -> float:
    """D = 1 - (1-eta)^n — saturating discrimination from contrast events."""
    return 1.0 - (1.0 - ETA_DISCRIMINATION) ** n_contrast
