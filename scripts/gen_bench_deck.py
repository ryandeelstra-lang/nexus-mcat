#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Deterministic synthetic 50k-card MCAT bench fixture (challenge 7h / §10). FSRS is enabled BEFORE
answering so answered cards carry memory_state; a synthetic sentinel is stamped so readiness labels
the data honestly. NEVER overlaps the eval gold set (tier-1: no leaked test data)."""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from anki.collection import Collection  # noqa: E402

from scores.engine import SYNTHETIC_MARKER, enable_fsrs  # noqa: E402

# 31+ content-category subdecks spread across the four MCAT regions (mirrors mcat_taxonomy.yaml paths).
_SECTIONS = ["B-B", "C-P", "P-S", "CARS"]


def _topic_paths(n_topics: int = 34) -> list[str]:
    paths = []
    i = 0
    while len(paths) < n_topics:
        sec = _SECTIONS[i % len(_SECTIONS)]
        paths.append(f"MCAT::{sec}::T{i:02d}")
        i += 1
    return paths


def _set_daily_limits(col: Collection, new_per_day: int, rev_per_day: int) -> None:
    # The default preset caps new cards at 20/day and reviews at 200/day — the answered slice
    # (thousands of cards in one synthetic "day") needs the caps lifted or getCard() stalls at 20.
    # Persist via decks.save() (the config-write path the engine's own scheduler tests use); the
    # legacy update_config() path does NOT reliably round-trip perDay in this build.
    for conf in col.decks.all_config():
        conf["new"]["perDay"] = new_per_day
        conf["rev"]["perDay"] = rev_per_day
        col.decks.save(conf)


def build(out_path: str, n_cards: int = 50000, n_answer: int = 4000, seed: int = 20260705) -> int:
    out = Path(out_path)
    if out.exists():
        out.unlink()
    rng = random.Random(seed)
    col = Collection(str(out))
    try:
        enable_fsrs(col)  # seeds FSRS-6 default params so memory_state computes with w20
        # 9999 is the engine's hard max for perDay — any larger value silently reverts to the default 20.
        _set_daily_limits(col, new_per_day=9999, rev_per_day=9999)
        col.set_config(SYNTHETIC_MARKER, True)  # tier-1 honesty sentinel
        topics = _topic_paths()
        deck_ids = [col.decks.id(p) for p in topics]
        model = col.models.by_name("Basic") or col.models.all()[0]
        col.models.set_current(model)
        made = 0
        for k in range(n_cards):
            did = deck_ids[k % len(deck_ids)]
            note = col.new_note(model)
            note["Front"] = f"bench-q-{k}-{rng.randint(0, 1 << 30)}"
            note["Back"] = f"bench-a-{k}"
            col.add_note(note, did)
            made += 1
        # Answer a slice so a realistic subset carries FSRS state + revlog rows. Cards are graduated
        # with Easy (new -> Review in one step) so the revlog carries GENUINE scheduled REVIEW rows
        # (ReviewKind.REVIEW == type 1); then the clock is jumped forward so those graduated cards fall
        # DUE and are re-reviewed, so a subset accrues >= 2 qualifying reviews — exactly what the
        # held-out calibration split needs. crt is the creation day; decreasing it moves "today"
        # forward, which is how Anki's own tests time-travel (pylib/tests/test_exporting.py).
        col.decks.select(col.decks.id("MCAT"))  # queue draws from the selected deck tree, not Default
        target = min(n_answer, made)
        col.reset()
        graduated = 0
        while graduated < target:
            card = col.sched.getCard()
            if card is None:
                break
            col.sched.answerCard(card, 4)  # Easy: new card graduates straight to a scheduled review
            graduated += 1
        # Re-review passes: silence NEW cards (perDay=0) so the queue serves ONLY the graduated review
        # cards, jump the clock forward so they fall due, then re-review them. This keeps the loop
        # bounded to the answered slice instead of draining the 46k untouched new backlog.
        _set_daily_limits(col, new_per_day=0, rev_per_day=9999)
        mcat_did = col.decks.id("MCAT")
        for _pass in range(3):
            col.crt = col.crt - 86400 * 400  # jump >1yr so every graduated review card is overdue
            col.reset()
            reviewed = 0
            # Review each due card ONCE, burying it after so a lapse can't recycle the queue onto the
            # same card (breadth over depth); unbury the whole tree at the end of the pass.
            while reviewed < target:
                card = col.sched.getCard()
                if card is None:
                    break
                col.sched.answerCard(card, rng.choice([2, 3, 3, 4]))  # Hard/Good/Good/Easy
                col.sched.bury_cards([card.id], manual=False)
                reviewed += 1
            col.sched.unbury_deck(mcat_did)
        review_rows = col.db.scalar("select count() from revlog where type = 1")
        if col.db.scalar("select count() from revlog") == 0:
            raise SystemExit("FATAL: bench fixture has no revlog rows — recall loop would be all-zeros")
        if review_rows == 0:
            raise SystemExit("FATAL: bench fixture has no scheduled REVIEW rows — calibration split empty")
        col.save()
        return made
    finally:
        col.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--cards", type=int, default=50000)
    ap.add_argument("--answer", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=20260705)
    a = ap.parse_args(argv)
    n = build(a.out, n_cards=a.cards, n_answer=a.answer, seed=a.seed)
    print(f"gen_bench_deck: wrote {n} cards to {a.out} (answered slice + FSRS state + synthetic marker)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
