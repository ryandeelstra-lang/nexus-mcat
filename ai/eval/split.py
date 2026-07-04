# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Read the FROZEN gold split. The held-out partition is read once for the reported numbers."""
from __future__ import annotations
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GOLD = REPO / "eval_gold" / "cardcheck_gold.jsonl"
SPLIT = REPO / "ai" / "gold" / "split.json"


def _pool() -> dict:
    return {json.loads(l)["id"]: json.loads(l) for l in GOLD.read_text(encoding="utf-8").splitlines() if l.strip()}


def load_ids(partition: str) -> list:
    return json.loads(SPLIT.read_text(encoding="utf-8"))[partition]


def load_heldout() -> list:
    pool = _pool()
    return [pool[i] for i in load_ids("heldout")]


def assert_disjoint() -> None:
    s = json.loads(SPLIT.read_text(encoding="utf-8"))
    tune, dev, held = set(s["tune"]), set(s["dev"]), set(s["heldout"])
    assert not (tune & dev) and not (tune & held) and not (dev & held), "gold split partitions overlap"
