#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Freeze a seeded, pairwise-disjoint 3-way partition of the gold pool. Deterministic (fixed seed):
re-running reproduces byte-identical split.json. tune>=20, dev>=20, heldout>=50 (heldout read ONCE)."""
from __future__ import annotations
import json, random
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GOLD = REPO / "eval_gold" / "cardcheck_gold.jsonl"
OUT = REPO / "ai" / "gold" / "split.json"
SEED = 20260703


def main() -> int:
    ids = [json.loads(l)["id"] for l in GOLD.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(ids) >= 90, f"need >=90 gold items, have {len(ids)}"
    random.Random(SEED).shuffle(ids)
    tune, dev, held = ids[:20], ids[20:40], ids[40:]
    assert len(held) >= 50
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"tune": tune, "dev": dev, "heldout": held}, indent=2), encoding="utf-8")
    print(f"split: tune={len(tune)} dev={len(dev)} heldout={len(held)} -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
