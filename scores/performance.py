# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Performance model (instructions §9 step 2): predict correctness on NEW reworded questions from
memory features. A tiny gradient-descent logistic regression (no sklearn dependency) trained on the
train split, evaluated on the held-out rewordings; reports accuracy + wrong-rate + bootstrap range vs a
majority baseline. Honest negative results are valid."""

from __future__ import annotations

import math
import random
import statistics


class PerfModel:
    def __init__(self):
        self.w = 0.0
        self.b = 0.0

    def fit(self, pairs: list[tuple[float, bool]], epochs: int = 400, lr: float = 0.5) -> "PerfModel":
        for _ in range(epochs):
            for x, y in pairs:
                z = self.w * x + self.b
                p = 1.0 / (1.0 + math.exp(-z))
                err = p - (1.0 if y else 0.0)
                self.w -= lr * err * x
                self.b -= lr * err
        return self

    def predict(self, x: float) -> float:
        return 1.0 / (1.0 + math.exp(-(self.w * x + self.b)))


def evaluate_pairs(
    train: list[tuple[float, bool]],
    held: list[tuple[float, bool]],
    seed: int = 20260705,
    boots: int = 1000,
) -> dict:
    model = PerfModel().fit(train)
    preds = [(model.predict(x) >= 0.5, y) for x, y in held]
    correct = [1 if p == y else 0 for p, y in preds]
    acc = statistics.mean(correct) if correct else 0.0
    wrong = 1.0 - acc
    # majority baseline
    maj = 1 if sum(1 for _x, y in held if y) >= len(held) / 2 else 0
    base = statistics.mean([1 if (bool(maj) == y) else 0 for _x, y in held]) if held else 0.0
    rng = random.Random(seed)
    boot = []
    for _ in range(boots):
        s = [correct[rng.randrange(len(correct))] for _ in correct] if correct else [0]
        boot.append(statistics.mean(s))
    boot.sort()
    lo = boot[int(0.05 * (len(boot) - 1))]
    hi = boot[int(0.95 * (len(boot) - 1))]
    return {
        "n": len(held),
        "accuracy": round(acc, 4),
        "wrong_rate": round(wrong, 4),
        "baseline_accuracy": round(base, 4),
        "range": [round(lo, 4), round(hi, 4)],
    }
