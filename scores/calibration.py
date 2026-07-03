# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Memory-model calibration on HELD-OUT reviews (instructions §6-Sunday / §9 step 1). Filters revlog to
genuine scheduled reviews (docs/05 residual risk 9), reconstructs predicted recall from PRIOR reviews
only, then reports a reliability curve + Brier + log-loss. Honest about synthetic data in the caption."""

from __future__ import annotations

import math
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
    from scores.data.split import heldout_by_card  # local import: split is a sibling data helper

    # Keep only genuine reviews before splitting, so held-out is genuine-review-only.
    genuine: dict[int, list] = {}
    for cid, rows in by_card.items():
        kept = []
        for (rid, _cid, ease, last_ivl, factor, kind, ivl) in rows:
            last_ivl_days = last_ivl / _DAY_S if abs(last_ivl) >= _DAY_S else last_ivl
            if filter_review_rows([(kind, ease, last_ivl_days, factor)]):
                kept.append((rid, _cid, ease, last_ivl, factor, kind, ivl))
        if len(kept) >= 2:
            genuine[cid] = kept
    _train, held = heldout_by_card(genuine, heldout_frac=0.2)
    out: list[Row] = []
    for (rid, cid, ease, last_ivl, factor, kind, ivl) in held:
        # stability proxy: the prior scheduled interval (days); elapsed = same (recall at due).
        stability_days = max(abs(last_ivl) / _DAY_S if abs(last_ivl) >= _DAY_S else abs(last_ivl), 1.0)
        elapsed_days = stability_days  # reviewed at/near due; documented surrogate (models/memory.md)
        pred = power_forgetting(elapsed_days, stability_days)
        out.append(Row(card_id=cid, predicted=round(pred, 4), success=is_success(ease)))
    return out
