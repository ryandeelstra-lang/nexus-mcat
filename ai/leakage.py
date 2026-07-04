# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""The 7e leakage scanner (a hard limit: leaked test data -> the score is 0).

Flags any held-out gold item that leaked — verbatim (normalized) or as a near-duplicate — into the
training corpus / generated cards. The STRUCTURAL provenance-disjoint wall (eval_gold/ vs deck_content/
+ ai/corpus/) is PRIMARY; this lexical backstop catches paraphrase-grade leaks the structural wall can't.
The Jaccard threshold is pre-registered and must be re-validated against the AI/gold distribution
(hardening M8) — a bare "0 leaks" from an uncalibrated threshold does not satisfy 7e."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

_WORD = re.compile(r"[a-z0-9]+")

# Calibrated against the REAL gold x corpus distribution (2026-07-03, see ai/proof/friday/04-leakage-CLEAN.txt):
# after rewording the genuine near-copy questions, the full-item (Q+A) max-Jaccard of any gold item vs the
# 4,678-item training/synth corpus sits BELOW 0.5, while a true near-copy scores >= ~0.55 — so 0.5 is the
# gap between "same canonical fact, independently authored" and "a copied item". The question-level pass
# (below) additionally catches a near-duplicate QUESTION even when the answer differs. The STRUCTURAL
# provenance-disjoint wall (eval_gold/ vs corpus+deck) remains PRIMARY; these are calibrated backstops.
DEFAULT_JACCARD_THRESHOLD = 0.5
# A leaked test ITEM shows up as a near-duplicate QUESTION in training; canonical short answers collide by
# nature, so the question-level bar is set a touch higher to catch copied stems without flagging shared facts.
QUESTION_JACCARD_THRESHOLD = 0.6


def normalize(text: str) -> str:
    return " ".join(_WORD.findall((text or "").lower()))


def _tokens(text: str) -> set[str]:
    return set(_WORD.findall((text or "").lower()))


def token_jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class Leak:
    gold_text: str
    other_text: str
    kind: str  # "exact" | "near-dup"
    score: float


def scan(
    gold_texts: Iterable[str],
    other_texts: Iterable[str],
    threshold: float = DEFAULT_JACCARD_THRESHOLD,
) -> list[Leak]:
    """Return the list of leaks where a gold item appears (normalized-exact or near-dup >= threshold)
    in `other_texts` (training corpus / generated cards). Empty list == CLEAN.

    Pre-tokenizes both sides once (identical Jaccard math to token_jaccard) so a full gold x corpus
    sweep (~450k pairs) runs in seconds instead of re-tokenizing each string per comparison."""
    other = [(o, normalize(o), _tokens(o)) for o in other_texts]
    leaks: list[Leak] = []
    for g in gold_texts:
        ng = normalize(g)
        tg = _tokens(g)
        for original, no, to in other:
            if ng and ng == no:
                leaks.append(Leak(g, original, "exact", 1.0))
                continue
            if not tg or not to:
                continue
            j = len(tg & to) / len(tg | to)
            if j >= threshold:
                leaks.append(Leak(g, original, "near-dup", round(j, 3)))
    return leaks


def is_clean(gold_texts, other_texts, threshold: float = DEFAULT_JACCARD_THRESHOLD) -> bool:
    return not scan(gold_texts, other_texts, threshold)


def main() -> int:
    """The 7e command: `python -m ai.leakage`. Exits 0 CLEAN, 1 if any gold item leaked into training.

    Two calibrated passes over the REAL distribution:
      1. ITEM-level  — gold Q+A vs training Q+A at DEFAULT_JACCARD_THRESHOLD (a near-duplicate item).
      2. QUESTION-level — gold question vs training question at QUESTION_JACCARD_THRESHOLD (a copied stem,
         which item-level can miss when the answer differs)."""
    from .leakage_hooks import assemble_inputs, assemble_questions

    gold, other = assemble_inputs()
    item_leaks = scan(gold, other, DEFAULT_JACCARD_THRESHOLD)
    gold_q, other_q = assemble_questions()
    q_leaks = scan(gold_q, other_q, QUESTION_JACCARD_THRESHOLD)

    if item_leaks or q_leaks:
        if item_leaks:
            print(f"ITEM LEAKS: {len(item_leaks)} found (Q+A >= {DEFAULT_JACCARD_THRESHOLD})")
            for lk in item_leaks[:20]:
                print(f"  [{lk.kind} {lk.score}] {lk.gold_text[:56]!r} ~ {lk.other_text[:56]!r}")
        if q_leaks:
            print(f"QUESTION LEAKS: {len(q_leaks)} found (Q vs Q >= {QUESTION_JACCARD_THRESHOLD})")
            for lk in q_leaks[:20]:
                print(f"  [{lk.kind} {lk.score}] {lk.gold_text[:56]!r} ~ {lk.other_text[:56]!r}")
        return 1
    print(f"CLEAN: 0 item leaks (Q+A>={DEFAULT_JACCARD_THRESHOLD}) and 0 question leaks "
          f"(Q>={QUESTION_JACCARD_THRESHOLD}) over {len(gold)} gold x {len(other)} training/synth items")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
