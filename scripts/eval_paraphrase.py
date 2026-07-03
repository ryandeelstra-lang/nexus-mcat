#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Challenge 7d command: print the recall-vs-reworded-accuracy gap with a bootstrap range."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scores import paraphrase  # noqa: E402

SET = Path(__file__).resolve().parents[1] / "scores" / "gold" / "paraphrase_set.jsonl"


def main() -> int:
    items = paraphrase.load_set(SET)
    g = paraphrase.gap(items)
    print("== 7d paraphrase test (30 cards x 2 rewordings) ==")
    print(f"n={g['n']}  mean_recall={g['mean_recall']}  mean_reworded_accuracy={g['mean_accuracy']}")
    print(f"GAP (mean |recall - accuracy|) = {g['gap']}  90% range {g['range']}")
    print("Interpretation: a non-trivial gap means performance != memory (the bridge exists).")
    return 0 if g["n"] == 30 else 1


if __name__ == "__main__":
    raise SystemExit(main())
