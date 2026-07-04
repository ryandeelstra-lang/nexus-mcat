# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_bm25_baseline.py
import json
from pathlib import Path

from ai.baselines import bm25


def test_bm25_uses_rank_bm25_and_tuned_params():
    # NB: BM25Okapi IDF goes to 0 for terms present in >= half the corpus, so a discriminating
    # term must be rare in the corpus; use a realistic multi-doc corpus (not a 2-doc toy).
    corpus = [
        "the mitochondrion is the powerhouse of the cell",
        "glycolysis nets two atp in the cytosol",
        "dna stores genetic information in a double helix",
        "proteins are chains of amino acids joined by peptide bonds",
        "water is a polar molecule that dissolves ionic compounds",
    ]
    r = bm25.BM25Retriever(corpus, k1=1.2, b=0.75)
    assert r.k1 == 1.2 and r.b == 0.75           # tuned params, not silent defaults
    ans = r.answer("what nets two atp")
    assert "glycolysis" in ans.lower()            # keyword retrieval returns the matching card text


def test_c4_metric_is_pre_registered():
    m = json.loads((Path(__file__).resolve().parents[1] / "c4_metric.json").read_text())
    assert m["primary_metric"] == "semantic-answer-correctness@heldout"
    assert m["secondary_metric"] == "answer-match-accuracy@heldout"
    assert m["arms"] == ["bm25", "ai"]
    assert "committed" in m and "match_threshold" in m
