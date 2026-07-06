# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Memory-model calibration on HELD-OUT reviews (instructions §6-Sunday / §9 step 1). Filters revlog to
genuine scheduled reviews (docs/05 residual risk 9), reconstructs predicted recall from PRIOR reviews
only, then reports a reliability curve + Brier + log-loss. Honest about synthetic data in the caption."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

_DAY_S = 86400
LEARNING, REVIEW, RELEARNING, FILTERED, MANUAL, RESCHEDULED = 0, 1, 2, 3, 4, 5
_DECAY = 0.5  # FSRS forgetting-curve decay magnitude used for the reproducible surrogate


@dataclass
class Row:
    card_id: int
    predicted: float
    success: bool


@dataclass
class Bin:
    lo: float
    hi: float
    n: int
    mean_predicted: float
    observed_rate: float


def is_success(button_chosen: int) -> bool:
    return button_chosen > 1  # Anki convention (today.rs:26)


def last_ivl_to_days(last_ivl: float) -> float:
    """revlog.lastIvl -> days. Anki sign convention (cards.ivl): POSITIVE = days, NEGATIVE =
    seconds. A magnitude test misreads a -600s learning step as 600 days and smuggles it past the
    scheduled-review filter — the sign is the only honest discriminator."""
    return last_ivl / _DAY_S if last_ivl < 0 else last_ivl


def filter_review_rows(raw: list[tuple]) -> list[tuple]:
    """raw row = (review_kind, button_chosen, last_interval_days, ease_factor). Keep genuine reviews only."""
    kept = []
    for kind, button, last_ivl_days, factor in raw:
        if button <= 0:                                    # drop MANUAL/RESCHEDULED style
            continue
        if kind in (MANUAL, RESCHEDULED):
            continue
        if kind == FILTERED and factor == 0:               # drop cram
            continue
        scheduled = kind == REVIEW or abs(last_ivl_days) >= 1
        if not scheduled:                                  # drop sub-day learning/relearning steps
            continue
        kept.append((kind, button, last_ivl_days, factor))
    return kept


def power_forgetting(elapsed_days: float, stability_days: float) -> float:
    s = max(stability_days, 1e-3)
    return (1.0 + (elapsed_days / s)) ** (-_DECAY)


def brier(rows: list[Row]) -> float:
    if not rows:
        return 0.0
    return round(sum((r.predicted - (1.0 if r.success else 0.0)) ** 2 for r in rows) / len(rows), 6)


def brier_ci(rows: list[Row], seed: int = 20260705, boots: int = 1000, level: float = 0.90) -> list[float]:
    """Seeded bootstrap interval on the Brier score — the honest stability check for small n
    (a real-review artifact must SAY when its n is too small for a stable Brier)."""
    if not rows:
        return [0.0, 0.0]
    rng = random.Random(seed)
    resampled = []
    for _ in range(boots):
        sample = [rows[rng.randrange(len(rows))] for _ in rows]
        resampled.append(brier(sample))
    resampled.sort()
    tail = (1.0 - level) / 2
    lo = resampled[int(tail * (len(resampled) - 1))]
    hi = resampled[int((1.0 - tail) * (len(resampled) - 1))]
    return [lo, hi]


def log_loss(rows: list[Row]) -> float:
    if not rows:
        return 0.0
    eps = 1e-9
    total = 0.0
    for r in rows:
        p = min(1 - eps, max(eps, r.predicted))
        total += -(math.log(p) if r.success else math.log(1 - p))
    return round(total / len(rows), 6)


def reliability_bins(rows: list[Row], k: int = 10) -> list[Bin]:
    bins = []
    for i in range(k):
        lo, hi = i / k, (i + 1) / k
        sel = [r for r in rows if (lo <= r.predicted < hi) or (i == k - 1 and r.predicted == 1.0)]
        n = len(sel)
        mp = sum(r.predicted for r in sel) / n if n else 0.0
        obs = sum(1 for r in sel if r.success) / n if n else 0.0
        bins.append(Bin(lo, hi, n, round(mp, 4), round(obs, 4)))
    return bins


def observed_recall_rows(col) -> list[Row]:
    """Held-out predicted-vs-observed rows over genuine reviews, prior-reviews-only prediction."""
    raw = col.db.all("select id, cid, ease, lastIvl, factor, type, ivl from revlog order by id")
    by_card: dict[int, list] = {}
    for rid, cid, ease, last_ivl, factor, kind, ivl in raw:
        by_card.setdefault(cid, []).append((rid, cid, ease, last_ivl, factor, kind, ivl))
    # local import: split is a sibling data helper
    from scores.data.split import heldout_by_card

    # Keep only genuine reviews before splitting, so held-out is genuine-review-only.
    genuine: dict[int, list] = {}
    for cid, rows in by_card.items():
        kept = []
        for (rid, _cid, ease, last_ivl, factor, kind, ivl) in rows:
            if filter_review_rows([(kind, ease, last_ivl_to_days(last_ivl), factor)]):
                kept.append((rid, _cid, ease, last_ivl, factor, kind, ivl))
        if len(kept) >= 2:
            genuine[cid] = kept
    _train, held = heldout_by_card(genuine, heldout_frac=0.2)
    out: list[Row] = []
    for (rid, cid, ease, last_ivl, factor, kind, ivl) in held:
        # stability proxy: the prior scheduled interval (days); elapsed = same (recall at due).
        stability_days = max(abs(last_ivl_to_days(last_ivl)), 1.0)
        elapsed_days = stability_days  # reviewed at/near due; documented surrogate (models/memory.md)
        pred = power_forgetting(elapsed_days, stability_days)
        out.append(Row(card_id=cid, predicted=round(pred, 4), success=is_success(ease)))
    return out
