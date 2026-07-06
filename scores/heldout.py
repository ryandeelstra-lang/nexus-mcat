# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Loader for the PUBLISHED held-out performance eval artifact (scripts/eval_performance.py).

This is the desktop twin of the phone's provenance-stamped HeldOutEval bundle artifact
(ScoreKit.swift): the dashboard's performance/readiness scores surface this MEASURED number or
they abstain. Nothing here computes, extrapolates, or defaults — a missing or unparseable
artifact is None, and None means abstention (tier-1: no fabricated readiness number)."""

from __future__ import annotations

import os
import re
from pathlib import Path

# Test/packaging seam: an absolute path to the artifact. When set it is authoritative — a missing
# file abstains rather than falling back, so a test can pin the no-artifact behavior.
ENV_KEY = "SCORES_HELDOUT_EVAL"

# The artifact this repo publishes (resolved from the package, never the cwd).
DEFAULT_ARTIFACT = (
    Path(__file__).resolve().parents[1] / "docs" / "release-proof" / "eval" / "performance-heldout.txt"
)

_RESULT_LINE = re.compile(
    r"n_heldout=(?P<n>\d+)\s+accuracy=(?P<acc>[\d.]+)\s+wrong_rate=(?P<wrong>[\d.]+)"
    r"\s+90% range=\[(?P<lo>[\d.]+),\s*(?P<hi>[\d.]+)\]\s+baseline=(?P<base>[\d.]+)"
)


def artifact_path() -> Path:
    env = os.environ.get(ENV_KEY)
    return Path(env) if env else DEFAULT_ARTIFACT


def load_heldout_eval() -> dict | None:
    """The measured held-out eval, or None (the abstain path) when missing/unparseable."""
    path = artifact_path()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    m = _RESULT_LINE.search(text)
    if not m:
        return None
    return {
        "n": int(m["n"]),
        "acc": float(m["acc"]),
        "acc_range": [float(m["lo"]), float(m["hi"])],
        "wrong_rate": float(m["wrong"]),
        "baseline": float(m["base"]),
        "source": str(path),
    }
