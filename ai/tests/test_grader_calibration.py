# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Calibration (voice spec §8): the grader must agree with human labels before the cutoffs ship.

Two tiers:
  * The LEXICAL floor alone is sanity-checked on the NON-paraphrase rows (paraphrase is exactly
    what a keyword floor can't see, so it is excluded from this tier).
  * The SEMANTIC run (requires ANTHROPIC_API_KEY, skipped otherwise) must clear the pre-registered
    agreement bar on ALL rows — the gate that lets the 90/70/40 cutoffs ship honestly.

Run the lexical tier out-of-process:
    PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 AI_DISABLED=1 out/pyenv/bin/python -m pytest \
        ai/tests/test_grader_calibration.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ai import grade

GOLD = Path(__file__).resolve().parents[2] / "eval_gold" / "spoken_gold.jsonl"
# Pre-registered BEFORE the first semantic run — retune the grader, never this bar.
SEMANTIC_AGREEMENT_BAR = 0.80

_BUCKET_ORDER = {"dont_know": 0, "ask_again": 1, "okay": 2, "good": 3}


def _rows() -> list[dict]:
    return [json.loads(line) for line in GOLD.read_text().splitlines() if line.strip()]


def test_gold_set_is_well_formed():
    rows = _rows()
    assert len(rows) >= 40
    labels = {r["label"] for r in rows}
    assert labels <= {"good", "okay", "ask_again", "dont_know"}
    # every tier is represented, including paraphrase (the SEMANTIC_HEADROOM stressor)
    assert any(r["label"] == "good" for r in rows)
    assert any(r["label"] == "dont_know" for r in rows)
    assert any(r.get("paraphrase") for r in rows)


def test_lexical_floor_never_overshoots_into_a_false_pass():
    """The deterministic floor is DOWNWARD-SAFE (voice spec §3 "round DOWN on uncertainty"):
    with AI off it may under-credit a correct paraphrase (that is the whole reason the semantic
    judge exists), but it must almost never grade an answer HIGHER than a human did, and must
    NEVER call a human dont_know/ask_again a "good". This is the property the AI-OFF path ships on.
    """
    rows = _rows()
    overshoots = 0
    for r in rows:
        g = grade.grade_spoken(r["question"], r["reference"], r["transcript"])
        graded, human = _BUCKET_ORDER[g.bucket], _BUCKET_ORDER[r["label"]]
        if graded > human:
            overshoots += 1
        # the hard invariant: a wrong/blank answer is never minted into a pass by the floor
        if human <= _BUCKET_ORDER["ask_again"]:
            assert g.bucket != "good", (
                f"floor minted a false GOOD from {r['label']!r}: {r['transcript']!r}"
            )
    # at most a small fraction may overshoot by one band (never a false good, asserted above)
    assert overshoots / len(rows) <= 0.10


@pytest.mark.skipif(
    not os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AI_DISABLED") == "1",
    reason="semantic calibration needs the judge (ANTHROPIC_API_KEY, AI enabled)",
)
def test_semantic_agreement_bar():
    rows = _rows()
    hits = sum(
        1
        for r in rows
        if grade.grade_spoken(r["question"], r["reference"], r["transcript"]).bucket
        == r["label"]
    )
    assert hits / len(rows) >= SEMANTIC_AGREEMENT_BAR
