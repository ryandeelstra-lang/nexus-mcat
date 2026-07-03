# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# Calibration (voice-Keeper spec §8): the grader must agree with human labels before the
# 90/70/40 cutoffs ship. Two tiers:
#   - the LEXICAL floor alone is sanity-checked on the non-paraphrase rows only (paraphrase
#     is exactly what a keyword match cannot see);
#   - the SEMANTIC run (needs ANTHROPIC_API_KEY, skipped otherwise) must clear the
#     pre-registered agreement bar on ALL rows including the synonym/paraphrase cases.
# The AGREEMENT bar is pre-registered here BEFORE the first run: retune the grader
# (SEMANTIC_HEADROOM etc.), never the bar.

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ai import grade

GOLD = Path(__file__).resolve().parents[2] / "eval_gold" / "spoken_gold.jsonl"

# Pre-registered bars (spec §8), set BEFORE the grader ships. Do not weaken to make a
# later run pass.
#
# The lexical bar is a low SANITY floor, not the ship gate: a pure keyword matcher
# legitimately cannot rate a terse correct answer ("Seven." vs the reference "A pH of 7.")
# as GOOD, because token overlap is low. Those misses are the documented motivation for the
# semantic judge — so the honest floor bar is 0.70 on literal rows.
#
# The load-bearing SHIP GATE is the semantic bar: with the judge on, agreement across ALL
# rows (including the synonym/paraphrase cases the floor is blind to) must clear 0.80.
LEXICAL_LITERAL_BAR = 0.70
SEMANTIC_AGREEMENT_BAR = 0.80


def _rows() -> list[dict]:
    return [json.loads(line) for line in GOLD.read_text().splitlines() if line.strip()]


def test_gold_set_is_well_formed() -> None:
    rows = _rows()
    assert len(rows) >= 40, "spec §8 wants ~80 tuples; keep growing this set"
    labels = {"good", "okay", "ask_again", "dont_know"}
    for r in rows:
        assert r["label"] in labels
        assert r["question"] and r["reference"] and r["transcript"]
    # The set must exercise paraphrase — the whole reason the lexical floor is not enough.
    assert sum(1 for r in rows if r.get("paraphrase")) >= 10


def test_lexical_floor_on_literal_rows() -> None:
    """The always-on floor must be honest on non-paraphrase answers (no judge needed)."""
    rows = [r for r in _rows() if not r.get("paraphrase")]
    hits = sum(
        1
        for r in rows
        if grade.grade_spoken(r["question"], r["reference"], r["transcript"]).bucket
        == r["label"]
    )
    agreement = hits / len(rows)
    assert agreement >= LEXICAL_LITERAL_BAR, (
        f"lexical floor agreement {agreement:.2f} < {LEXICAL_LITERAL_BAR} on literal rows"
    )


@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AI_DISABLED") == "1",
    reason="semantic calibration needs the Claude judge (ANTHROPIC_API_KEY, AI on)",
)
def test_semantic_agreement_bar() -> None:
    """With the judge on, agreement across ALL rows (incl. paraphrase) must clear the bar."""
    rows = _rows()
    hits = sum(
        1
        for r in rows
        if grade.grade_spoken(r["question"], r["reference"], r["transcript"]).bucket
        == r["label"]
    )
    agreement = hits / len(rows)
    assert agreement >= SEMANTIC_AGREEMENT_BAR, (
        f"semantic agreement {agreement:.2f} < {SEMANTIC_AGREEMENT_BAR}; "
        "retune SEMANTIC_HEADROOM/DISAGREEMENT_LIMIT, never the bar"
    )
