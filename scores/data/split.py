# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Deterministic, TIME-BASED held-out split: the last `heldout_frac` of each card's qualifying
revlog rows (by ascending revlog id == wall-clock ms) are held out. No randomness, reproducible."""

from __future__ import annotations


def heldout_by_card(rows_by_card: dict[int, list], heldout_frac: float = 0.2) -> tuple[list, list]:
    train, held = [], []
    for _cid, rows in rows_by_card.items():
        rows = sorted(rows, key=lambda r: r[0])  # r[0] == revlog id
        cut = int(len(rows) * (1.0 - heldout_frac))
        train.extend(rows[:cut])
        held.extend(rows[cut:])
    return train, held
