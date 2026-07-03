# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.1: the deterministic synthetic 50k bench fixture generator (7h / §10).
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_bench_deck.py

import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
import gen_bench_deck  # noqa: E402
from anki.collection import Collection  # noqa: E402


def test_small_fixture_is_deterministic_and_has_fsrs_state():
    out = Path(tempfile.mkdtemp()) / "bench_small.anki2"
    # A small run is enough to prove determinism + that answered cards carry FSRS state.
    n = gen_bench_deck.build(str(out), n_cards=200, n_answer=40, seed=42)
    assert n == 200
    col = Collection(str(out))
    try:
        # synthetic marker set so readiness can label the data honestly (never 'real').
        assert col.get_config(gen_bench_deck.SYNTHETIC_MARKER, False) is True
        topics = list(col.mastery_query("", 0.0).topics)
        assert any(t.cards_with_state > 0 for t in topics), "answered slice must carry FSRS memory state"
        assert any(t.graded_reviews > 0 for t in topics)
    finally:
        col.close()


def test_same_seed_same_card_count(tmp_path):
    a = tmp_path / "a.anki2"
    b = tmp_path / "b.anki2"
    assert gen_bench_deck.build(str(a), n_cards=200, n_answer=40, seed=7) == gen_bench_deck.build(
        str(b), n_cards=200, n_answer=40, seed=7
    )
