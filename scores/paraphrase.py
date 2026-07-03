# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Challenge 7d: measure the gap between recall on a card and accuracy on reworded exam-style questions
testing the same idea. A near-zero gap means the performance model just copies memory (no bridge)."""

from __future__ import annotations

import json
import random
import statistics
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Rewording:
    q: str
    correct: bool


@dataclass
class Item:
    id: str
    topic: str
    recall: float
    rewordings: list[Rewording]


def load_set(path) -> list[Item]:
    items = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        items.append(
            Item(
                id=d["id"],
                topic=d["topic"],
                recall=float(d["recall"]),
                rewordings=[Rewording(r["q"], bool(r["correct"])) for r in d["rewordings"]],
            )
        )
    return items


def _item_accuracy(it: Item) -> float:
    return sum(1 for r in it.rewordings if r.correct) / len(it.rewordings)


def gap(items: list[Item], seed: int = 20260705, boots: int = 1000) -> dict:
    recalls = [it.recall for it in items]
    accs = [_item_accuracy(it) for it in items]
    diffs = [abs(r - a) for r, a in zip(recalls, accs)]
    rng = random.Random(seed)
    boot_means = []
    for _ in range(boots):
        sample = [diffs[rng.randrange(len(diffs))] for _ in diffs] if diffs else [0.0]
        boot_means.append(statistics.mean(sample))
    boot_means.sort()
    lo = boot_means[int(0.05 * (len(boot_means) - 1))]
    hi = boot_means[int(0.95 * (len(boot_means) - 1))]
    return {
        "n": len(items),
        "mean_recall": round(statistics.mean(recalls), 4) if recalls else 0.0,
        "mean_accuracy": round(statistics.mean(accs), 4) if accs else 0.0,
        "gap": round(statistics.mean(diffs), 4) if diffs else 0.0,
        "range": [round(lo, 4), round(hi, 4)],
    }
