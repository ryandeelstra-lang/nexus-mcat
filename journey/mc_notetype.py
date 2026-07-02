# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""J0b — the MCAT multiple-choice notetype + runtime chosen-distractor capture.

Two cleanly separated halves so the runtime stays additive (Decision 19):

  * ``ensure_mcq_notetype`` / ``add_mcq_note`` run at **deck-authoring time** (offline, in
    ``gen_mcat_deck.py``) — installing a notetype is a legitimate authoring mutation, exactly like
    adding any note or deck, and ships baked into the seed collection.
  * ``record_mc_answer`` runs at **review time** and writes ONLY to the ``scores.telemetry`` sidecar
    (the chosen distractor / correctness / cause) — it never mutates the collection, so the
    read-only / no-schema-bump tier-1 gates hold at runtime.

The MC notetype is the substrate the reworded-variant DOK2 gate (O4), trap aggregation (L6 debrief),
and error-cause tagging (J4) all read.
"""

from __future__ import annotations

from anki.collection import Collection
from anki.decks import DeckId
from anki.notes import Note

from scores.telemetry import sidecar

MCQ_NOTETYPE_NAME = "MCAT MCQ"

# Field order is the wire contract for the template; Correct holds the letter A-D.
FIELDS = ("Stem", "OptionA", "OptionB", "OptionC", "OptionD", "Correct", "Explanation", "Source")

_QFMT = """\
<div class="mcat-stem">{{Stem}}</div>
<ol class="mcat-options" type="A">
  <li>{{OptionA}}</li>
  <li>{{OptionB}}</li>
  <li>{{OptionC}}</li>
  <li>{{OptionD}}</li>
</ol>
"""

# Calm answer side (never red): correct option + why + source. The "why this lure is wrong" and the
# one-tap cause picker are layered by the reviewer coaching panel (J4/J7), not the static template.
_AFMT = """\
{{FrontSide}}
<hr id="answer">
<div class="mcat-correct">Correct: {{Correct}}</div>
<div class="mcat-explanation">{{Explanation}}</div>
<div class="mcat-source">Source: {{Source}}</div>
"""

_CSS = """\
.card { font-family: Inter, system-ui, sans-serif; color: #1B1D2A; background: #FBFBFD; }
.mcat-stem { font-size: 1.1em; margin-bottom: 0.75em; }
.mcat-options li { margin: 0.35em 0; }
.mcat-source { color: #6B7280; font-size: 0.85em; margin-top: 0.5em; }
"""


def ensure_mcq_notetype(col: Collection) -> int:
    """Idempotently install the MCAT MCQ notetype; return its id. Build-time (authoring) op."""
    existing = col.models.by_name(MCQ_NOTETYPE_NAME)
    if existing is not None:
        return int(existing["id"])
    mm = col.models
    m = mm.new(MCQ_NOTETYPE_NAME)
    for field_name in FIELDS:
        mm.add_field(m, mm.new_field(field_name))
    template = mm.new_template("MCQ")
    template["qfmt"] = _QFMT
    template["afmt"] = _AFMT
    mm.add_template(m, template)
    m["css"] = _CSS
    return int(mm.add_dict(m).id)


def add_mcq_note(
    col: Collection,
    deck_id: DeckId,
    *,
    stem: str,
    options: dict[str, str],
    correct: str,
    explanation: str = "",
    source: str = "",
) -> Note:
    """Add one MCQ note (build-time). ``options`` keyed 'A'..'D'; ``correct`` is the letter."""
    m = col.models.by_name(MCQ_NOTETYPE_NAME)
    if m is None:
        ensure_mcq_notetype(col)
        m = col.models.by_name(MCQ_NOTETYPE_NAME)
    assert m is not None
    note = col.new_note(m)
    note["Stem"] = stem
    note["OptionA"] = options.get("A", "")
    note["OptionB"] = options.get("B", "")
    note["OptionC"] = options.get("C", "")
    note["OptionD"] = options.get("D", "")
    note["Correct"] = correct
    note["Explanation"] = explanation
    note["Source"] = source
    col.add_note(note, deck_id)
    return note


def record_mc_answer(
    col: Collection,
    *,
    node_id: str,
    chosen: str,
    correct: str,
    total_ms: int | None = None,
    is_fresh_variant: bool = False,
    error_cause: str | None = None,
    revlog_id: int | None = None,
    mode: str = sidecar.MODE_REVIEW,
) -> int | None:
    """Capture an MC answer to the sidecar (runtime, additive). ``chosen``/``correct`` are letters.

    A *distractor* is recorded only when the answer is wrong (the lure the learner fell for); a
    correct answer chose no distractor. Returns the sidecar row id, or None when analytics are off.
    """
    is_correct = chosen == correct
    return sidecar.record_item_attempt(
        col,
        mode=mode,
        node_id=node_id,
        correct=is_correct,
        total_ms=total_ms,
        chosen_distractor_id=None if is_correct else chosen,
        is_fresh_variant=is_fresh_variant,
        error_cause=error_cause,
        revlog_id=revlog_id,
    )
