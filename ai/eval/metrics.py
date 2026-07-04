# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Accuracy + wrong-answer rate + correct-but-bad-teaching over the three-bucket counts."""
from __future__ import annotations


def summarize(counts: dict, n: int) -> dict:
    n = max(n, 1)
    return {
        "accuracy": round(counts.get("correct-and-useful", 0) / n, 4),
        "wrong_answer_rate": round(counts.get("wrong", 0) / n, 4),
        "bad_teaching": counts.get("correct-but-bad-teaching", 0),
        "n": n,
    }
