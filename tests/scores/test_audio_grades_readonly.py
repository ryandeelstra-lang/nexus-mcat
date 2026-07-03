# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up voice flashcards (doc 24 §5/§11/§16): the audio-grade sidecar wall.
# The ONLY collection write is the sanctioned answerCard; the transcript, score and bucket live
# ONLY in mcat_sidecar.sqlite (never in collection.anki2). Spec ruling 4: the garden's client-side
# store is the one economy ledger — the server-side economy tables were DROPPED and must not exist.
# Out-of-process:
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_audio_grades_readonly.py

import os
import tempfile

from anki.collection import Collection
from anki.decks import DeckId

from scores.telemetry import sidecar


def _fresh_col() -> Collection:
    fd, path = tempfile.mkstemp(suffix=".anki2")
    os.close(fd)
    os.unlink(path)
    return Collection(path)


def _answer_one(col: Collection) -> None:
    note = col.newNote()
    note["Front"] = "q"
    note["Back"] = "a"
    col.add_note(note, DeckId(1))
    card = col.sched.getCard()
    assert card is not None
    col.sched.answerCard(card, 3)


def _snapshot(col: Collection):
    return {
        "revlog": col.db.all("select * from revlog order by id"),
        "cards": col.db.all("select * from cards order by id"),
        "notes": col.db.all("select * from notes order by id"),
        "config": col.db.all("select key, val from config order by key"),
        "scm": col.db.scalar("select scm from col"),
    }


def test_audio_grade_is_collection_read_only():
    """Writing an audio grade leaves the collection byte-identical (§5.1)."""
    col = _fresh_col()
    _answer_one(col)
    before = _snapshot(col)

    gid = sidecar.record_audio_grade(
        col,
        node_id="MCAT::B-B::1A",
        card_id=101,
        transcript="the mitochondria makes ATP",
        score=93.5,
        bucket="good",
        method="lexical",
        rating=2,
        revlog_id=1,
        is_fresh_variant=True,
    )
    assert gid is not None

    after = _snapshot(col)
    assert before == after  # collection untouched; everything lives in the sidecar
    col.close()


def test_audio_grade_row_shape():
    col = _fresh_col()
    gid = sidecar.record_audio_grade(
        col,
        node_id="MCAT::P-S::8A",
        card_id=42,
        transcript="self concept",
        score=91.0,
        bucket="good",
        method="semantic",
        rating=3,
        reference_hash="abc123",
        is_fresh_variant=True,
        stt_provider="local",
        stt_model="faster-whisper/small",
        grade_source_id="grader:claude-structured-v1",
    )
    rows = sidecar.read_audio_grades(col, "MCAT::P-S::8A")
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == gid
    assert row["card_id"] == 42
    assert row["bucket"] == "good"
    assert row["method"] == "semantic"
    assert row["is_fresh_variant"] == 1
    assert row["stt_provider"] == "local"
    assert row["grade_source_id"] == "grader:claude-structured-v1"
    col.close()


def test_no_tables_ever_appear_in_the_collection():
    col = _fresh_col()
    sidecar.record_audio_grade(
        col,
        node_id="MCAT::C-P::4A",
        card_id=7,
        transcript="x",
        score=10,
        bucket="dont_know",
        method="lexical",
    )
    names = {
        r[0] for r in col.db.all("select name from sqlite_master where type='table'")
    }
    assert "audio_grades" not in names
    assert "garden_economy" not in names
    assert "garden_ledger" not in names
    col.close()


def test_no_economy_tables_in_sidecar():
    """Spec ruling 4: the garden store is the one ledger — no server-side economy tables."""
    col = _fresh_col()
    sidecar.record_audio_grade(
        col,
        node_id="MCAT::P-S::8A",
        card_id=1,
        transcript="self concept",
        score=91.0,
        bucket="good",
        method="lexical",
    )
    conn = sidecar.connect(col)
    assert conn is not None
    try:
        names = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert "garden_economy" not in names
        assert "garden_ledger" not in names
        assert "audio_grades" in names
    finally:
        conn.close()
    assert not hasattr(sidecar, "credit_currency")
    assert not hasattr(sidecar, "get_balance")
    col.close()


def test_audio_grade_feeds_variant_passed_predicate():
    """A passed reworded variant flips the existing bloom predicate (journey.dok.variant_passed)."""
    from journey import dok

    col = _fresh_col()
    sidecar.record_audio_grade(
        col,
        node_id="MCAT::B-B::1A",
        card_id=5,
        transcript="right",
        score=95,
        bucket="good",
        method="lexical",
        is_fresh_variant=True,
    )
    assert dok.variant_passed(col, "MCAT::B-B::1A") is True
    # a non-variant good answer alone does not satisfy the paraphrase gate
    sidecar.record_audio_grade(
        col,
        node_id="MCAT::C-P::4A",
        card_id=6,
        transcript="right",
        score=95,
        bucket="good",
        method="lexical",
        is_fresh_variant=False,
    )
    assert dok.variant_passed(col, "MCAT::C-P::4A") is False
    col.close()


def test_disabled_is_a_noop(monkeypatch):
    monkeypatch.setenv("ANALYTICS_DISABLED", "1")
    col = _fresh_col()
    assert (
        sidecar.record_audio_grade(
            col,
            node_id="n",
            card_id=1,
            transcript="x",
            score=1,
            bucket="good",
            method="lexical",
        )
        is None
    )
    assert sidecar.read_audio_grades(col) == []
    col.close()
