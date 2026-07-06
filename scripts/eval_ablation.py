#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""§8 three-build interleaving ablation — one seeded command (challenge §8; G1-G3, D4-D5).

Runs FULL / ABLATION / PLAIN over the pre-registered paired design and writes
docs/release-proof/eval/ablation.txt (also printed). Thin wrapper over the
canonical scores/ablation/run.py so the SU3 eval_all chain and this script
cannot drift apart. Run from the repo root:

    PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python scripts/eval_ablation.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scores.ablation.run import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
