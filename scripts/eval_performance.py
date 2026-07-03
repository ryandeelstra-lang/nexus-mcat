#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Challenge §9 step 2 command: held-out exam-style accuracy + wrong-rate + range vs baseline. Uses the
7d gold rewordings as the held-out exam-style set; asserts the 7e wall CLEAN first (in-repo re-scan)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scores import paraphrase, performance  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
SET = REPO / "scores" / "gold" / "paraphrase_set.jsonl"


def _leakage_clean() -> bool:
    r = subprocess.run(
        [str(REPO / "out/pyenv/bin/python"), str(REPO / "scripts/leakage_gate.py")],
        cwd=str(REPO),
        env={"PYTHONPATH": f"{REPO / 'out/pylib'}:{REPO}"},
        capture_output=True,
        text=True,
    )
    sys.stderr.write(r.stdout + r.stderr)
    return r.returncode == 0


def main() -> int:
    if not _leakage_clean():
        sys.stderr.write("[eval_performance] ABORT: 7e leakage scan not CLEAN\n")
        return 3
    items = paraphrase.load_set(SET)
    # feature = source-card recall; label = per-rewording correctness. Split items 60/40 by id order.
    pairs = [(it.recall, r.correct) for it in items for r in it.rewordings]
    cut = int(len(pairs) * 0.6)
    res = performance.evaluate_pairs(pairs[:cut], pairs[cut:])
    print("== Performance model — held-out exam-style accuracy ==")
    print(
        f"n_heldout={res['n']}  accuracy={res['accuracy']}  wrong_rate={res['wrong_rate']}  "
        f"90% range={res['range']}  baseline={res['baseline_accuracy']}"
    )
    print(f"beats_baseline = {res['accuracy'] > res['baseline_accuracy']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
