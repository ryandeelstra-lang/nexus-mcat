# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_leakage_calibration.py
from ai import leakage, leakage_hooks


def test_scanner_flags_near_copy_but_not_legit_pairs():
    # The lexical backstop targets near-COPIES (high token overlap); the structural provenance-disjoint
    # wall is primary. DEFAULT_JACCARD_THRESHOLD=0.6 is calibrated to catch near-copies (>= ~0.6 overlap)
    # while leaving genuinely distinct questions on the same fact CLEAN (< 0.6).
    gold = ["the citric acid cycle occurs in the mitochondrial matrix"]
    near_copy = ["the citric acid cycle occurs within the mitochondrial matrix"]          # near-copy (~0.87)
    distinct = ["glycolysis happens in the cytosol and nets two ATP"]                      # legitimately distinct
    assert leakage.token_jaccard(gold[0], near_copy[0]) >= 0.6
    assert leakage.scan(gold, near_copy), "a near-copy must be flagged"
    assert leakage.is_clean(gold, distinct), "a legitimately distinct pair must NOT be flagged"


def test_hooks_assemble_gold_vs_training_corpus():
    gold_texts, other_texts = leakage_hooks.assemble_inputs()
    assert len(gold_texts) >= 90 and len(other_texts) >= 100
    assert leakage.is_clean(gold_texts, other_texts), "the real gold set must be CLEAN vs the training/synth corpus"
