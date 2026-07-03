#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Challenge §6-Sunday / §9 step 1: memory calibration + Brier/log-loss on HELD-OUT reviews. Asserts the
7e leakage wall is CLEAN first (reuses W2a's ai.leakage). Prints an ASCII reliability curve so the
evidence file is self-contained; states honestly when the underlying data is synthetic."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from anki.collection import Collection  # noqa: E402

from scores import calibration  # noqa: E402
from scores.engine import data_provenance  # noqa: E402

DEFAULT_FIXTURE = "/tmp/bench50k.anki2"


def _leakage_clean(repo: Path) -> bool:
    # Run the REAL in-repo 7e re-scan (scripts/leakage_gate.py wraps ai/leakage.py's scanner over the
    # actual held-out gold vs the training corpus). `python -m ai.leakage` is W2a's module-level seam.
    r = subprocess.run(
        [str(repo / "out/pyenv/bin/python"), str(repo / "scripts/leakage_gate.py")],
        cwd=str(repo),
        env={"PYTHONPATH": f"{repo / 'out/pylib'}:{repo}"},
        capture_output=True,
        text=True,
    )
    sys.stderr.write(r.stdout + r.stderr)
    return r.returncode == 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default=DEFAULT_FIXTURE)
    a = ap.parse_args(argv)
    repo = Path(__file__).resolve().parents[1]
    if not _leakage_clean(repo):
        sys.stderr.write("[eval_memory] ABORT: 7e leakage scan not CLEAN\n")
        return 3
    col = Collection(a.collection)
    try:
        rows = calibration.observed_recall_rows(col)
        prov = data_provenance(col)
    finally:
        col.close()
    b, ll = calibration.brier(rows), calibration.log_loss(rows)
    bins = calibration.reliability_bins(rows)
    print("== Memory calibration (held-out reviews) ==")
    print(
        f"data_provenance = {prov}"
        + ("   (SYNTHETIC — calibration shape only, not a real learner)" if prov == "synthetic" else "")
    )
    print(f"n_heldout = {len(rows)}   Brier = {b}   log_loss = {ll}")
    print(f"{'bin':>10}{'n':>7}{'mean_pred':>12}{'observed':>10}")
    for bn in bins:
        bar = "#" * int(bn.observed_rate * 20)
        print(f"{bn.lo:.1f}-{bn.hi:.1f}{bn.n:>7}{bn.mean_predicted:>12}{bn.observed_rate:>10}  {bar}")
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
