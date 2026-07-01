# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up telemetry — the per-device analytics/journey sidecar.

ALL mutable journey state (item attempts, sessions, and later the DOK / diagnostic / teach-back
tables) lives in ``<collection_dir>/mcat_sidecar.sqlite`` on its OWN sqlite3 connection — NEVER the
Collection/_backend handle. This makes a collection write structurally impossible, so the
"read freely, act additively" wall (Decision 19) and the no-schema-bump / no-corruption tier-1
gates hold by construction. Out-of-process: not part of ``just check``.
"""
