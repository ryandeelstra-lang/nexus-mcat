# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""charged_up scores — the three honest scores (Memory / Performance / Readiness).

Out-of-process (not part of `just check`). Every score CONSUMES the read-only MasteryQuery RPC
(it never recomputes FSRS) and is emitted ONLY through ``display.wrap_score`` so it always carries
a range + the five honesty elements, or a structured abstention via the give-up rule. No code path
outside ``display`` may emit a readiness number (tier-1: no fabricated/misleading numbers).
"""
