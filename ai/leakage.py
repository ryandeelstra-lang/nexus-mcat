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

# Pre-registered backstop threshold (re-validate against the AI/gold distribution per F-AI.4).
DEFAULT_JACCARD_THRESHOLD = 0.6


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
    in `other_texts` (training corpus / generated cards). Empty list == CLEAN."""
    norm_other = [(o, normalize(o)) for o in other_texts]
    leaks: list[Leak] = []
    for g in gold_texts:
        ng = normalize(g)
        for original, no in norm_other:
            if ng and ng == no:
                leaks.append(Leak(g, original, "exact", 1.0))
                continue
            j = token_jaccard(g, original)
            if j >= threshold:
                leaks.append(Leak(g, original, "near-dup", round(j, 3)))
    return leaks


def is_clean(gold_texts, other_texts, threshold: float = DEFAULT_JACCARD_THRESHOLD) -> bool:
    return not scan(gold_texts, other_texts, threshold)
