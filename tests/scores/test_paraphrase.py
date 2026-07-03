# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.4: 7d paraphrase test — recall-vs-reworded-accuracy gap over 30x2 gold.
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_paraphrase.py

from pathlib import Path

from scores import paraphrase

SET = Path(__file__).resolve().parents[2] / "scores" / "gold" / "paraphrase_set.jsonl"


def test_set_shape_30_cards_2_rewordings_each():
    items = paraphrase.load_set(SET)
    assert len(items) == 30
    for it in items:
        assert len(it.rewordings) == 2
        assert it.id and it.topic


def test_gap_zero_when_reworded_matches_recall():
    from scores.paraphrase import Item, Rewording

    items = [Item(id="x", topic="t", recall=1.0, rewordings=[Rewording("q1", True), Rewording("q2", True)])]
    g = paraphrase.gap(items)
    assert g["mean_recall"] == 1.0 and g["mean_accuracy"] == 1.0 and g["gap"] == 0.0


def test_gap_large_when_memorized_but_cannot_transfer():
    from scores.paraphrase import Item, Rewording

    items = [Item(id="x", topic="t", recall=1.0, rewordings=[Rewording("q1", False), Rewording("q2", False)])]
    g = paraphrase.gap(items)
    assert g["gap"] == 1.0  # perfect recall, zero transfer -> the bridge is not built
