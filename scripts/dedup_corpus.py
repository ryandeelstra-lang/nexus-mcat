#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""charged_up: deterministic global de-duplication of the synthesized DOK-1 corpus.

Per-leaf synthesis can independently produce the SAME fact under two genuinely-related leaves
(e.g. "point mutation" under both gene->protein transmission and genetic-diversity). This step keeps
the FIRST occurrence of each normalized front across the whole corpus (deterministic: files in sorted
order, lines in file order) and drops later identical fronts, so a student never reviews an identical
card twice. Coverage floors still hold (margins are large). Re-runnable + idempotent.

    PYTHONPATH= out/pyenv/bin/python scripts/dedup_corpus.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ai.leakage import normalize  # reuse the SAME normalizer the test/leakage scan uses

CORPUS_DIR = ROOT / "ai" / "corpus" / "cards"


def main() -> None:
    seen: set[str] = set()
    removed = 0
    kept_total = 0
    for path in sorted(CORPUS_DIR.glob("*.jsonl")):
        kept: list[str] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            key = normalize(card["front"])
            if key in seen:
                removed += 1
                continue
            seen.add(key)
            # canonical compact serialization, stable key order
            kept.append(
                json.dumps(
                    {
                        "leaf_id": card["leaf_id"],
                        "deck_path": card["deck_path"],
                        "concept_id": card.get("concept_id", ""),
                        "front": card["front"],
                        "back": card["back"],
                        "source_id": card["source_id"],
                        "dok": card.get("dok", 1),
                        "yield": card.get("yield", "medium"),
                    },
                    ensure_ascii=False,
                )
            )
        path.write_text("\n".join(kept) + "\n", encoding="utf-8")
        kept_total += len(kept)
    print(f"dedup: removed {removed} duplicate-front cards; kept {kept_total} unique across the corpus")


if __name__ == "__main__":
    main()
