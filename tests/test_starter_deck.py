# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: end-to-end pin for the prefilled deck — build_full_deck (seed + synthesized corpus) ->
# .apkg -> first-run import into a fresh collection -> per-node MasteryQuery rollup (the graph's data
# source). Out-of-process (needs the built anki on PYTHONPATH); auto-skips otherwise so `just check`
# is unaffected:
#   PYTHONPATH=out/pylib out/pyenv/bin/python -m pytest tests/test_starter_deck.py

import importlib.util
import os
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

pytest.importorskip("anki", reason="needs the built anki on PYTHONPATH (PYTHONPATH=out/pylib)")


def _load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_full_deck", ROOT / "scripts" / "build_full_deck.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_full_deck_builds_imports_and_rolls_up_per_node():
    from anki.collection import (
        Collection,
        ImportAnkiPackageOptions,
        ImportAnkiPackageRequest,
    )

    builder = _load_builder()
    tmp = tempfile.mkdtemp()
    out = os.path.join(tmp, "full.anki2")
    apkg = os.path.join(tmp, "full.apkg")

    built = builder.build(out, apkg)
    assert built > 4000, f"expected the full corpus (seed + ~4.4k), got {built}"
    assert os.path.exists(apkg)

    fresh = Collection(os.path.join(tmp, "fresh.anki2"))
    try:
        # first-run guard condition + idempotency
        assert fresh.decks.by_name("MCAT") is None
        fresh.import_anki_package(
            ImportAnkiPackageRequest(
                package_path=apkg,
                options=ImportAnkiPackageOptions(
                    merge_notetypes=False, with_scheduling=True, with_deck_configs=True
                ),
            )
        )
        assert fresh.decks.by_name("MCAT") is not None  # imported
        assert fresh.card_count() == built  # nothing dropped on import

        # the graph's live data source: per-leaf rollup returns a real Topic
        topics = fresh.mastery_query('deck:"MCAT::B-B::1A"', 0.0).topics
        assert any(
            "1A" in t.deck_name and t.total_cards > 0 for t in topics
        ), f"MasteryQuery gave no rollup for BB.1A: {[t.deck_name for t in topics]}"
    finally:
        fresh.close()
