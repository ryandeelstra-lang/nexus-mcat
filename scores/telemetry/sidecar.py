# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""J0a — the charged_up telemetry sidecar (Decisions 34-38 journey foundation; doc 16; plan step J0a).

The sidecar is opened on its OWN ``sqlite3`` connection at ``<collection_dir>/mcat_sidecar.sqlite`` —
never the Collection/``_backend`` handle, so it can never write the collection (the engine opens the
collection with ``PRAGMA locking_mode = exclusive``). It registers NO global sqlite extension (no
``sqlite3_auto_extension``); any extension (e.g. sqlite-vec, later) is registered on THIS connection
only. This is the substrate the diagnostic (W7b/T8), DOK predicate (W9b/T9), teach-back grader
(F-AI.11), and mock debrief (S-DEBRIEF) all read/write — every one additive, none touching FSRS.

Feature flag: set ``ANALYTICS_DISABLED=1`` to make every write a no-op (and reads return empty).
"""

from __future__ import annotations

import os
import sqlite3
import time
from typing import Any

from anki.collection import Collection

# Keyed to the collection FILE (beside it, like Anki's `<stem>.media`), so one profile dir can hold
# distinct collections without sharing a sidecar — and so temp test collections never collide.
SIDECAR_SUFFIX = ".mcat_sidecar.sqlite"

# item_attempts.mode values (the unit the DOK predicate + debrief read).
MODE_REVIEW = "review"
MODE_DIAGNOSTIC = "diagnostic"
MODE_TIMED = "timed"

# The error-cause taxonomy (loop #1 / Decision 28a); stored verbatim in item_attempts.error_cause.
ERROR_CAUSES = ("careless", "concept-gap", "stem-misread", "lure-trapped", "time-pressure")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS item_attempts (
    id                    INTEGER PRIMARY KEY,
    ts                    INTEGER NOT NULL,
    mode                  TEXT    NOT NULL,
    node_id               TEXT    NOT NULL,
    correct               INTEGER NOT NULL,
    total_ms              INTEGER,
    chosen_distractor_id  TEXT,
    is_fresh_variant      INTEGER NOT NULL DEFAULT 0,
    error_cause           TEXT,
    revlog_id             INTEGER
);
CREATE INDEX IF NOT EXISTS ix_item_attempts_node_variant ON item_attempts(node_id, is_fresh_variant);
CREATE INDEX IF NOT EXISTS ix_item_attempts_node_correct ON item_attempts(node_id, correct);

CREATE TABLE IF NOT EXISTS sessions (
    id                  INTEGER PRIMARY KEY,
    ts                  INTEGER NOT NULL,
    mode                TEXT    NOT NULL,
    breaks_json         TEXT,
    fatigue_slope       REAL,
    final_section_delta REAL,
    accuracy            REAL,
    completed_items     INTEGER,
    abandoned           INTEGER NOT NULL DEFAULT 0
);

-- Voice-flashcard per-answer telemetry (doc 24 §11). Additive; NEVER in collection.anki2.
-- NOTE (spec ruling 4): no garden_economy/garden_ledger here — the garden's client-side store
-- (gardenState doc) is the one currency ledger; the server only reports the bucket.
CREATE TABLE IF NOT EXISTS audio_grades (
    id               INTEGER PRIMARY KEY,
    ts               INTEGER NOT NULL,
    node_id          TEXT    NOT NULL,          -- deck path (join key)
    card_id          INTEGER NOT NULL,
    revlog_id        INTEGER,                   -- links to the engine revlog row (like item_attempts)
    transcript       TEXT    NOT NULL,
    reference_hash   TEXT,                      -- hash of the reference answer (audit; no leakage)
    score            REAL    NOT NULL,          -- 0..100 measured match
    bucket           TEXT    NOT NULL,          -- good|okay|ask_again|dont_know
    rating           INTEGER,                   -- v3 ease applied (null if re-ask pending)
    method           TEXT    NOT NULL,          -- semantic|lexical
    is_fresh_variant INTEGER NOT NULL DEFAULT 0,-- 1 when a reworded variant was asked (paraphrase gate)
    error_cause      TEXT,
    stt_provider     TEXT,
    stt_model        TEXT,
    grade_source_id  TEXT                       -- C2 provenance of the grading rubric (if AI)
);
CREATE INDEX IF NOT EXISTS ix_audio_grades_node ON audio_grades(node_id, is_fresh_variant);
"""


def _disabled() -> bool:
    return bool(os.environ.get("ANALYTICS_DISABLED"))


def sidecar_path(col: Collection) -> str:
    """The sidecar lives beside the .anki2 file, keyed to it (never inside it)."""
    return os.path.splitext(os.path.abspath(col.path))[0] + SIDECAR_SUFFIX


def connect(col: Collection) -> sqlite3.Connection | None:
    """Open the sidecar on its OWN connection (WAL, ``Row`` factory, schema ensured).

    Returns ``None`` when ``ANALYTICS_DISABLED`` is set. Never touches ``col.db`` / the engine handle;
    registers no process-global sqlite extension.
    """
    if _disabled():
        return None
    conn = sqlite3.connect(sidecar_path(col))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def record_item_attempt(
    col: Collection,
    *,
    mode: str,
    node_id: str,
    correct: bool,
    total_ms: int | None = None,
    chosen_distractor_id: str | None = None,
    is_fresh_variant: bool = False,
    error_cause: str | None = None,
    revlog_id: int | None = None,
) -> int | None:
    """Append one item attempt. Returns its row id, or ``None`` when analytics are disabled."""
    conn = connect(col)
    if conn is None:
        return None
    try:
        cur = conn.execute(
            "INSERT INTO item_attempts(ts, mode, node_id, correct, total_ms, "
            "chosen_distractor_id, is_fresh_variant, error_cause, revlog_id) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (
                int(time.time()),
                mode,
                node_id,
                1 if correct else 0,
                total_ms,
                chosen_distractor_id,
                1 if is_fresh_variant else 0,
                error_cause,
                revlog_id,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        conn.close()


def record_session(
    col: Collection,
    *,
    mode: str,
    breaks_json: str | None = None,
    fatigue_slope: float | None = None,
    final_section_delta: float | None = None,
    accuracy: float | None = None,
    completed_items: int | None = None,
    abandoned: bool = False,
) -> int | None:
    """Append one (timed/mock) session row. Returns its row id, or ``None`` when disabled."""
    conn = connect(col)
    if conn is None:
        return None
    try:
        cur = conn.execute(
            "INSERT INTO sessions(ts, mode, breaks_json, fatigue_slope, final_section_delta, "
            "accuracy, completed_items, abandoned) VALUES (?,?,?,?,?,?,?,?)",
            (
                int(time.time()),
                mode,
                breaks_json,
                fatigue_slope,
                final_section_delta,
                accuracy,
                completed_items,
                1 if abandoned else 0,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        conn.close()


def read_item_attempts(col: Collection, node_id: str | None = None) -> list[dict[str, Any]]:
    """Read item attempts (optionally for one node), newest-id last. Empty when disabled."""
    conn = connect(col)
    if conn is None:
        return []
    try:
        if node_id is None:
            rows = conn.execute("SELECT * FROM item_attempts ORDER BY id").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM item_attempts WHERE node_id=? ORDER BY id", (node_id,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# --- Voice-flashcard audio grades (doc 24 §11) ------------------------------------------------


def record_audio_grade(
    col: Collection,
    *,
    node_id: str,
    card_id: int,
    transcript: str,
    score: float,
    bucket: str,
    method: str,
    rating: int | None = None,
    revlog_id: int | None = None,
    reference_hash: str | None = None,
    is_fresh_variant: bool = False,
    error_cause: str | None = None,
    stt_provider: str | None = None,
    stt_model: str | None = None,
    grade_source_id: str | None = None,
) -> int | None:
    """Append one spoken/typed answer grade to the sidecar. Returns its row id (or None if disabled).

    A ``review`` row is ALSO written to ``item_attempts`` so the existing paraphrase-pass predicate
    (``journey.dok.variant_passed`` → ``is_fresh_variant==1 AND correct==1``) lights the bloom off a
    spoken pass with no changes to that reader.
    """
    conn = connect(col)
    if conn is None:
        return None
    try:
        cur = conn.execute(
            "INSERT INTO audio_grades(ts, node_id, card_id, revlog_id, transcript, reference_hash, "
            "score, bucket, rating, method, is_fresh_variant, error_cause, stt_provider, stt_model, "
            "grade_source_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                int(time.time()),
                node_id,
                card_id,
                revlog_id,
                transcript,
                reference_hash,
                score,
                bucket,
                rating,
                method,
                1 if is_fresh_variant else 0,
                error_cause,
                stt_provider,
                stt_model,
                grade_source_id,
            ),
        )
        # Mirror into item_attempts so the DOK/bloom predicate sees a spoken pass with no changes.
        conn.execute(
            "INSERT INTO item_attempts(ts, mode, node_id, correct, is_fresh_variant, error_cause, "
            "revlog_id) VALUES (?,?,?,?,?,?,?)",
            (
                int(time.time()),
                MODE_REVIEW,
                node_id,
                1 if bucket in ("good", "okay") else 0,
                1 if is_fresh_variant else 0,
                error_cause,
                revlog_id,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        conn.close()


def read_audio_grades(col: Collection, node_id: str | None = None) -> list[dict[str, Any]]:
    """Read audio grades (optionally for one node), newest-id last. Empty when disabled."""
    conn = connect(col)
    if conn is None:
        return []
    try:
        if node_id is None:
            rows = conn.execute("SELECT * FROM audio_grades ORDER BY id").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audio_grades WHERE node_id=? ORDER BY id", (node_id,)
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
