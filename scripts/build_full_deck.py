#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""charged_up: build the FULL prefilled MCAT deck and export a bundled .apkg for first-run import.

Two inputs, both committed, reviewed, static artifacts (the deck is a build product, never live-AI):
  * ``deck_content/cards.jsonl``  — the pinned TINY self-authored seed (provenance="self-authored-original").
  * ``ai/corpus/cards/*.jsonl``   — the synthesized DOK-1 corpus; every card carries a ``source_id`` that
    MUST resolve in ``ai/corpus/sources.jsonl`` (the C2 provenance gate) or this build refuses.

Cards are added into the taxonomy subdeck named by ``deck_path`` (e.g. ``MCAT::B-B::1A``) so the engine's
MasteryQuery rolls each leaf up to its knowledge-graph node. FSRS-6 is enabled so memory_state is later
computed with the default 21-weight params (never all-zeros).

Run via the anki pyenv (anki on PYTHONPATH):

    PYTHONPATH=out/pylib out/pyenv/bin/python scripts/build_full_deck.py \
        --out /tmp/mcat_full.anki2 --apkg /tmp/mcat_full.apkg
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))  # so `ai.provenance` (repo-root package) imports under PYTHONPATH=out/pylib

from ai.provenance import ProvenanceStore  # noqa: E402
from anki.collection import Collection, ExportAnkiPackageOptions  # noqa: E402
from anki.decks import DeckId, UpdateDeckConfigs, UpdateDeckConfigsMode  # noqa: E402

SEED = ROOT / "deck_content" / "cards.jsonl"
CORPUS_DIR = ROOT / "ai" / "corpus" / "cards"
SOURCES = ROOT / "ai" / "corpus" / "sources.jsonl"


def enable_fsrs(col: Collection) -> None:
    """The only correct way to enable FSRS in Python; seeds the FSRS-6 21-weight default params."""
    req = col.decks.get_deck_configs_for_update(DeckId(1))
    upd = UpdateDeckConfigs(
        target_deck_id=1,
        configs=[cw.config for cw in req.all_config],
        mode=UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL,
        fsrs=True,
    )
    col.decks.update_deck_configs(upd)


def _iter_seed():
    if not SEED.exists():
        return
    for line in SEED.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        c = json.loads(line)
        yield c["deck_path"], c["front"], c["back"]


def _iter_corpus(store: ProvenanceStore):
    if not CORPUS_DIR.exists():
        return
    for path in sorted(CORPUS_DIR.glob("*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            c = json.loads(line)
            sid = (c.get("source_id") or "").strip()
            if store.resolve(sid) is None:
                raise SystemExit(
                    f"C2 violation: corpus card in {path.name} has unresolvable source_id {sid!r}"
                )
            yield c["deck_path"], c["front"], c["back"]


def build(out_path: str, apkg_path: str | None = None) -> int:
    if os.path.exists(out_path):
        os.remove(out_path)
    col = Collection(out_path)
    try:
        enable_fsrs(col)
        store = ProvenanceStore.from_jsonl(SOURCES)
        rows = list(_iter_seed()) + list(_iter_corpus(store))
        for deck_path, front, back in rows:
            deck_id = col.decks.id(deck_path)
            note = col.newNote()
            note["Front"] = front
            note["Back"] = back
            col.add_note(note, deck_id)
        count = col.card_count()
        if apkg_path:
            if os.path.exists(apkg_path):
                os.remove(apkg_path)
            col.export_anki_package(
                out_path=apkg_path,
                limit=None,  # whole collection
                options=ExportAnkiPackageOptions(
                    with_scheduling=True,
                    with_deck_configs=True,
                    with_media=False,
                    legacy=False,
                ),
            )
        return count
    finally:
        col.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the charged_up FULL prefilled MCAT deck.")
    ap.add_argument("--out", required=True, help="output .anki2 path")
    ap.add_argument("--apkg", help="optional bundled .apkg path for first-run import")
    args = ap.parse_args()
    count = build(args.out, args.apkg)
    print(f"built {count} cards -> {args.out}" + (f" (+ {args.apkg})" if args.apkg else ""))


if __name__ == "__main__":
    main()
