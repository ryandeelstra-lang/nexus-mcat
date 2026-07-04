# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Readiness score mapping (instructions §4 / §9 step 3). Documented, UNVALIDATED linear map from
held-out performance accuracy onto the MCAT 472-528 scale, with a range that propagates the performance
bootstrap interval widened by a coverage penalty. Never emits a point below the give-up floor."""

from __future__ import annotations

SCALE_LO, SCALE_HI = 472, 528
SECTION_LO, SECTION_HI, N_SECTIONS = 118, 132, 4


def _section_score(acc: float) -> float:
    acc = max(0.0, min(1.0, acc))
    return SECTION_LO + (SECTION_HI - SECTION_LO) * acc


def map_to_scale(section_perf: dict, coverage: float) -> dict:
    acc = section_perf["acc"]
    lo_acc, hi_acc = section_perf.get("acc_range", [acc, acc])
    point = round(_section_score(acc) * N_SECTIONS)
    penalty = (1.0 - max(0.0, min(1.0, coverage))) * (SCALE_HI - SCALE_LO) * 0.1  # coverage widens the band
    lo = round(_section_score(lo_acc) * N_SECTIONS - penalty)
    hi = round(_section_score(hi_acc) * N_SECTIONS + penalty)
    point = max(SCALE_LO, min(SCALE_HI, point))
    return {"point": point, "range": [max(SCALE_LO, lo), min(SCALE_HI, hi)]}
