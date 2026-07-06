#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Challenge §6-Sunday / §9 step 1: memory calibration + Brier/log-loss on HELD-OUT reviews. Asserts the
7e leakage wall is CLEAN first (reuses W2a's ai.leakage). Prints an ASCII reliability curve so the
evidence file is self-contained; states honestly when the underlying data is synthetic.

The target collection is NEVER opened in place: the script copies it (plus any sqlite sidecar files)
to a private temp dir and works on the snapshot — so it runs against the user's REAL collection even
while the live app holds the collection lock, and cannot write a byte to the source. The snapshot's
integrity is verified before any number is reported.

Stability rule (pre-stated, not tuned): a real-review run is fit to be the PRIMARY calibration
artifact only when n_heldout >= 500 AND the Brier 90% bootstrap CI half-width is <= 0.02. Below
that, the verdict says so plainly and the synthetic artifact remains primary."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from anki.collection import Collection  # noqa: E402
from scores import calibration  # noqa: E402
from scores.engine import data_provenance  # noqa: E402

DEFAULT_FIXTURE = "/tmp/bench50k.anki2"
PRIMARY_MIN_N = 500
PRIMARY_MAX_CI_HALF_WIDTH = 0.02


def _leakage_clean(repo: Path) -> bool:
    # Run the REAL in-repo 7e re-scan (scripts/leakage_gate.py wraps ai/leakage.py's scanner over the
    # actual held-out gold vs the training corpus). `python -m ai.leakage` is W2a's module-level seam.
    r = subprocess.run(
        [str(repo / "out/pyenv/bin/python"), str(repo / "scripts/leakage_gate.py")],
        check=False, cwd=str(repo),
        env={"PYTHONPATH": f"{repo / 'out/pylib'}:{repo}"},
        capture_output=True,
        text=True,
    )
    sys.stderr.write(r.stdout + r.stderr)
    return r.returncode == 0


def _snapshot(src: Path, tmpdir: Path) -> Path:
    """Copy the collection + sqlite sidecars into tmpdir. The source is read, never opened."""
    dst = tmpdir / src.name
    shutil.copy2(src, dst)
    for suffix in ("-wal", "-shm", "-journal"):
        side = src.parent / (src.name + suffix)
        if side.exists():
            shutil.copy2(side, tmpdir / side.name)
    return dst


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default=DEFAULT_FIXTURE)
    a = ap.parse_args(argv)
    repo = Path(__file__).resolve().parents[1]
    if not _leakage_clean(repo):
        sys.stderr.write("[eval_memory] ABORT: 7e leakage scan not CLEAN\n")
        return 3
    src = Path(a.collection)
    if not src.is_file():
        sys.stderr.write(f"[eval_memory] ABORT: no collection at {src}\n")
        return 2
    with tempfile.TemporaryDirectory(prefix="eval-memory-") as tmp:
        copy = _snapshot(src, Path(tmp))
        col = Collection(str(copy))  # opening the copy replays any copied WAL; the source is untouched
        try:
            integrity = col.db.scalar("pragma integrity_check")
            if integrity != "ok":
                sys.stderr.write(f"[eval_memory] ABORT: snapshot integrity_check = {integrity!r}\n")
                return 4
            total_revlog = col.db.scalar("select count() from revlog")
            rows = calibration.observed_recall_rows(col)
            prov = data_provenance(col)
        finally:
            col.close()
    print("== Memory calibration (held-out reviews) ==")
    print(f"source_collection = {src}   (opened as a verified read-only snapshot; integrity_check=ok)")
    print(
        f"data_provenance = {prov}"
        + ("   (SYNTHETIC — calibration shape only, not a real learner)" if prov == "synthetic" else "")
    )
    if not rows:
        print(f"n_heldout = 0   (of {total_revlog} revlog rows, none survive the genuine-scheduled-review")
        print("filter with >= 2 qualifying reviews per card — Brier/log-loss are UNDEFINED, not zero)")
        print("verdict: NOT USABLE as a calibration artifact — no held-out rows to score.")
        return 1
    b, ll = calibration.brier(rows), calibration.log_loss(rows)
    ci = calibration.brier_ci(rows)
    half_width = (ci[1] - ci[0]) / 2
    bins = calibration.reliability_bins(rows)
    print(f"n_heldout = {len(rows)}   Brier = {b}   log_loss = {ll}")
    print(f"brier_90ci = [{ci[0]}, {ci[1]}]   (seeded bootstrap, 1000 resamples; half-width {half_width:.4f})")
    print(f"{'bin':>10}{'n':>7}{'mean_pred':>12}{'observed':>10}")
    for bn in bins:
        bar = "#" * int(bn.observed_rate * 20)
        print(f"{bn.lo:.1f}-{bn.hi:.1f}{bn.n:>7}{bn.mean_predicted:>12}{bn.observed_rate:>10}  {bar}")
    stable = len(rows) >= PRIMARY_MIN_N and half_width <= PRIMARY_MAX_CI_HALF_WIDTH
    print(
        f"stability rule: n_heldout >= {PRIMARY_MIN_N} AND Brier 90% CI half-width <= "
        f"{PRIMARY_MAX_CI_HALF_WIDTH} -> {'MET' if stable else 'NOT MET'}"
    )
    if prov == "real" and not stable:
        print(
            "verdict: real-review n is too small for a stable Brier — the synthetic artifact "
            "(memory-calibration.txt) remains PRIMARY; this artifact documents the real-data machinery."
        )
    elif prov == "real":
        print("verdict: stable real-review calibration — fit to serve as the PRIMARY artifact.")
    else:
        print("verdict: synthetic-data calibration — shape/machinery evidence, not a real learner.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
