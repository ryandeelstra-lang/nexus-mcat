#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""7e leakage re-scan (challenge §7e), the REAL gate the Sunday eval track runs before reporting any
held-out number. Uses the ai/leakage.py scanner to check that every held-out GOLD item is provenance-
disjoint from the training corpus (the generated cards + the self-authored deck). Exits 0 CLEAN / 1 on
any leak. `python -m ai.leakage` is W2a's module-level seam (a hard gate once W2a lands its __main__);
this script is W3's genuine in-repo re-scan so the archived evidence reflects an actual scan, not a
trivially-passing import."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai.leakage import scan  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def _gold_texts() -> list[str]:
    """The genuinely HELD-OUT gold that must be provenance-disjoint from training: the 7d paraphrase
    rewordings (authored in the gold namespace, reworded so they never appear in the deck/AI corpus).
    NOTE: eval_gold/spoken_gold.jsonl is deliberately deck-derived (W2b's audio-grading harness) and is
    NOT a held-out-from-training set, so it is intentionally excluded from the 7e disjointness wall."""
    texts: list[str] = []
    para = REPO / "scores" / "gold" / "paraphrase_set.jsonl"
    if para.exists():
        for line in para.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            d = json.loads(line)
            for r in d.get("rewordings", []):
                texts.append(r.get("q", ""))
    return [t for t in texts if t]


def _corpus_texts() -> list[str]:
    """Training corpus: the generated AI cards + the self-authored deck (what a leak would live in)."""
    texts: list[str] = []
    cards_dir = REPO / "ai" / "corpus" / "cards"
    if cards_dir.exists():
        for f in sorted(cards_dir.glob("*.jsonl")):
            for line in f.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                d = json.loads(line)
                texts.append(f"{d.get('front', '')} {d.get('back', '')}".strip())
    deck = REPO / "deck_content" / "cards.jsonl"
    if deck.exists():
        for line in deck.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            d = json.loads(line)
            texts.append(f"{d.get('front', '')} {d.get('back', '')}".strip())
    return [t for t in texts if t]


def clean() -> tuple[bool, int, list]:
    gold = _gold_texts()
    corpus = _corpus_texts()
    leaks = scan(gold, corpus)
    return (not leaks, len(leaks), leaks)


def main(argv=None) -> int:
    ok, n_leaks, leaks = clean()
    gold_n = len(_gold_texts())
    corpus_n = len(_corpus_texts())
    print("== 7e leakage re-scan (ai/leakage.py) ==")
    print(f"gold items scanned = {gold_n}   corpus items scanned = {corpus_n}")
    if ok:
        print("CLEAN: 0 leaks — every held-out gold item is disjoint from the training corpus")
        return 0
    print(f"LEAK: {n_leaks} held-out gold item(s) found in the corpus — held-out is NOT held-out")
    for lk in leaks[:10]:
        print(f"  [{lk.kind} {lk.score}] {lk.gold_text[:70]!r} ~ {lk.other_text[:70]!r}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
