#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""charged_up: build the tiny self-authored MCAT seed deck into a .anki2 (Block C W6).

Re-runnable + deterministic: reads deck_content/cards.jsonl, creates the taxonomy subdecks,
adds Basic notes, enables FSRS (so memory_state is later computed with the FSRS-6 default
params, never all-zeros), and writes the collection. Run via the anki pyenv with anki on
PYTHONPATH, e.g.:

    PYTHONPATH=out/pylib out/pyenv/bin/python scripts/gen_mcat_deck.py --out /tmp/mcat_seed.anki2
"""

import argparse
import json
import os
from pathlib import Path

from anki.collection import Collection
from anki.decks import DeckId, UpdateDeckConfigs, UpdateDeckConfigsMode

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "deck_content" / "cards.jsonl"


def enable_fsrs(col: Collection) -> None:
    """The only correct way to enable FSRS in Python (no Config.Bool.FSRS exists);
    update_deck_configs(fsrs=True) seeds the FSRS-6 21-weight default params."""
    req = col.decks.get_deck_configs_for_update(DeckId(1))
    upd = UpdateDeckConfigs(
        target_deck_id=1,
        configs=[cw.config for cw in req.all_config],
        mode=UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL,
        fsrs=True,
    )
    col.decks.update_deck_configs(upd)


def build(out_path: str) -> int:
    if os.path.exists(out_path):
        os.remove(out_path)
    col = Collection(out_path)
    try:
        enable_fsrs(col)
        for line in CARDS.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            deck_id = col.decks.id(card["deck_path"])
            note = col.newNote()
            note["Front"] = card["front"]
            note["Back"] = card["back"]
            col.add_note(note, deck_id)
        return col.card_count()
    finally:
        col.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the charged_up MCAT seed deck.")
    ap.add_argument("--out", required=True, help="output .anki2 path")
    args = ap.parse_args()
    count = build(args.out)
    print(f"built {count} cards -> {args.out}")


if __name__ == "__main__":
    main()
