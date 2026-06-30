# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up: the 7e leakage scanner — seeded leaks are caught, a clean (disjoint) set passes.
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_leakage.py

from ai.leakage import DEFAULT_JACCARD_THRESHOLD, is_clean, normalize, scan, token_jaccard


def test_normalize_and_jaccard():
    assert normalize("Net ATP yield: 2!") == "net atp yield 2"
    assert token_jaccard("the cat sat", "the cat sat") == 1.0
    assert token_jaccard("abc def", "xyz qrs") == 0.0


def test_exact_normalized_copy_is_flagged():
    gold = ["What is the net ATP yield of glycolysis?"]
    corpus = ["Some unrelated text.", "what is the NET atp yield of glycolysis"]
    leaks = scan(gold, corpus)
    assert any(leak.kind == "exact" for leak in leaks)
    assert not is_clean(gold, corpus)


def test_paraphrase_near_dup_is_flagged():
    gold = ["the citric acid cycle occurs in the mitochondrial matrix"]
    corpus = ["the citric acid cycle occurs in the matrix of the mitochondria"]
    leaks = scan(gold, corpus)
    assert leaks, "a paraphrase-grade near-duplicate must be flagged"
    assert leaks[0].score >= DEFAULT_JACCARD_THRESHOLD


def test_disjoint_clean_set_has_zero_leaks():
    gold = ["what is the resting membrane potential of a neuron"]
    corpus = ["glycolysis nets two ATP per glucose", "water has a high specific heat capacity"]
    assert is_clean(gold, corpus)
    assert scan(gold, corpus) == []
