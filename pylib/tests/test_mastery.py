# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: the required "Python calls my Rust change" test for the MasteryQuery RPC (B2 / 7a).

from tests.shared import getEmptyCol


def test_mastery_query():
    col = getEmptyCol()
    # Smoke FIRST: the keyword-only generated stub + the wrapper defaults wire up (no TypeError).
    # A positional inner call, or an omitted kwarg, would raise here.
    assert col.mastery_query() is not None

    # A note in a named subdeck shows up as exactly one topic with one card.
    deck_id = col.decks.id("MCAT::C-P")
    note = col.newNote()
    note["Front"] = "What does glycolysis net per glucose?"
    note["Back"] = "2 ATP, 2 NADH, 2 pyruvate"
    col.add_note(note, deck_id)

    resp = col.mastery_query("deck:MCAT::C-P")
    assert len(resp.topics) == 1
    topic = resp.topics[0]
    assert topic.deck_id == deck_id
    assert topic.total_cards == 1
    assert "C-P" in topic.deck_name
    # A brand-new card has no FSRS state yet.
    assert topic.cards_with_state == 0
    col.close()
