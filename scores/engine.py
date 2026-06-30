# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Thin read-only adapter onto the engine's MasteryQuery RPC (Block B).

The scores layer NEVER recomputes FSRS — it reads the per-topic aggregates the engine already
computes (mastered count, average recall, graded-review event count, stability, decay).
"""

from __future__ import annotations

from anki.collection import Collection
from anki.decks import DeckId, UpdateDeckConfigs, UpdateDeckConfigsMode

# Marker (collection config) set by the synthetic bench-deck generator (Block H / S4).
SYNTHETIC_MARKER = "mcat_synthetic"


def enable_fsrs(col: Collection) -> None:
    """The only correct way to enable FSRS in Python — update_deck_configs(fsrs=True) seeds the
    FSRS-6 21-weight default params (there is no Config.Bool.FSRS)."""
    req = col.decks.get_deck_configs_for_update(DeckId(1))
    upd = UpdateDeckConfigs(
        target_deck_id=1,
        configs=[cw.config for cw in req.all_config],
        mode=UpdateDeckConfigsMode.UPDATE_DECK_CONFIGS_MODE_NORMAL,
        fsrs=True,
    )
    col.decks.update_deck_configs(upd)


def mastery_topics(col: Collection, search: str = "", threshold: float = 0.0):
    """Per-topic mastery rows from the read-only RPC (a list of Topic protos)."""
    return list(col.mastery_query(search, threshold).topics)


def total_graded_reviews(topics) -> int:
    """Total graded revlog EVENTS across topics (the give-up gate's unit — not distinct cards)."""
    return sum(t.graded_reviews for t in topics)


def data_provenance(col: Collection) -> str:
    """'synthetic' if the collection bears the synthetic-bench marker, else 'real'."""
    return "synthetic" if col.get_config(SYNTHETIC_MARKER, False) else "real"
