# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""charged_up: the Knowledge Garden's ADDITIVE state store (Decisions 40-42; docs/26 I5).

Persistent garden state — the currency balances (seeds/water), the pending "sow now, answer
next visit" queue, tutorial-beat progress, waystone unlocks, paraphrase-pass records, and
cosmetic state — lives HERE, in the same additive sidecar SQLite that already holds telemetry
(`scores.telemetry.sidecar`), keyed beside the collection file and NEVER inside it.

The integrity wall (Decision 19, docs/26 §1):
  - This module never writes to the Anki collection, revlog, FSRS state, or schema.
  - The garden reads engine truth (masteryQuery / scoresDashboard / the review loop) and
    stores only its own presentation-layer state here.
  - Deleting this store loses cosmetic/queue state only — never a review, never mastery.

Schema: one key-value table of JSON documents, versioned. The garden's TS layer owns the
document shapes (ts/routes/garden/state/store.ts); Python is a dumb, additive persistence
seam so state survives restarts and profile moves without touching the collection.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from anki.collection import Collection

from . import sidecar

_GARDEN_SCHEMA = """
CREATE TABLE IF NOT EXISTS garden_state (
    key TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    updated_ms INTEGER NOT NULL,
    doc TEXT NOT NULL
);
"""

# Keys the TS store round-trips today. Kept as a doc-comment, not an allowlist — the store is
# a generic seam; shapes are owned/validated by the TS layer.
#   "economy"    -> {seeds, water, xp}
#   "pending"    -> {queued: [{nodeId, kind, ts}]}
#   "tutorial"   -> {beat, done}
#   "paraphrase" -> {passed: {nodeId: ts}}
#   "unlocks"    -> {waystones: [id], gates: [id]}
#   "settings"   -> {muted, volume}


def _connect(col: Collection) -> sqlite3.Connection:
    conn = sqlite3.connect(sidecar.sidecar_path(col))
    conn.executescript(_GARDEN_SCHEMA)
    return conn


def get_state(col: Collection, key: str | None = None) -> dict[str, Any]:
    """Read the whole garden document map (or one key). Read-only on the collection."""
    conn = _connect(col)
    try:
        if key is None:
            rows = conn.execute("SELECT key, doc FROM garden_state").fetchall()
        else:
            rows = conn.execute(
                "SELECT key, doc FROM garden_state WHERE key = ?", (key,)
            ).fetchall()
        return {k: json.loads(doc) for (k, doc) in rows}
    finally:
        conn.close()


def set_state(col: Collection, key: str, doc: dict[str, Any], now_ms: int) -> None:
    """Upsert one garden document. Additive sidecar write only (Decision 19)."""
    conn = _connect(col)
    try:
        with conn:
            conn.execute(
                "INSERT INTO garden_state (key, version, updated_ms, doc)"
                " VALUES (?, 1, ?, ?)"
                " ON CONFLICT(key) DO UPDATE SET updated_ms = excluded.updated_ms,"
                " doc = excluded.doc",
                (key, now_ms, json.dumps(doc, separators=(",", ":"))),
            )
    finally:
        conn.close()
