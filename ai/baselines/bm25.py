# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""The keyword baseline (challenge: beat keyword/vector search). REAL rank_bm25 (not hand-rolled),
k1/b tuned on the dev split. It "answers" by retrieving the best-matching corpus card's text."""
from __future__ import annotations
import re

from rank_bm25 import BM25Okapi

_WORD = re.compile(r"[a-z0-9]+")


def _tok(text: str) -> list:
    return _WORD.findall((text or "").lower())


class BM25Retriever:
    def __init__(self, corpus_texts: list, k1: float = 1.5, b: float = 0.75):
        self.corpus_texts = corpus_texts
        self.k1, self.b = k1, b
        self._bm25 = BM25Okapi([_tok(t) for t in corpus_texts], k1=k1, b=b)

    def answer(self, question: str) -> str:
        scores = self._bm25.get_scores(_tok(question))
        if not len(scores):
            return ""
        return self.corpus_texts[max(range(len(scores)), key=lambda i: scores[i])]
