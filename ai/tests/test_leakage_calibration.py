# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_leakage_calibration.py
from ai import leakage, leakage_hooks


def test_item_scanner_flags_near_copy_but_not_shared_fact():
    # The 0.5 item-level threshold is calibrated to the REAL distribution: it flags a near-COPY (high
    # Q+A overlap) but NOT two independently-authored items that merely share the same canonical fact.
    gold = ["the citric acid cycle occurs in the mitochondrial matrix"]
    near_copy = ["the citric acid cycle occurs within the mitochondrial matrix"]              # ~0.87 -> flag
    shared_fact = ["name the sub-organelle space that houses the krebs enzymes: the matrix"]  # same fact, distinct wording
    assert leakage.token_jaccard(gold[0], near_copy[0]) >= leakage.DEFAULT_JACCARD_THRESHOLD
    assert leakage.scan(gold, near_copy, leakage.DEFAULT_JACCARD_THRESHOLD), "a near-copy item must flag"
    assert leakage.is_clean(gold, shared_fact, leakage.DEFAULT_JACCARD_THRESHOLD), "shared-fact distinct wording must NOT flag"


def test_question_scanner_catches_verbatim_stem_even_if_answer_differs():
    # A copied QUESTION is a leak even when the answer text differs; the question-level pass catches it.
    gold_q = ["state ohm's law relating voltage current and resistance"]
    copied_q = ["state ohm's law relating voltage current and resistance"]     # verbatim stem -> flag
    distinct_q = ["a car accelerates from rest; what is its momentum after 3 seconds"]  # unrelated
    assert leakage.scan(gold_q, copied_q, leakage.QUESTION_JACCARD_THRESHOLD), "a verbatim question stem must flag"
    assert leakage.is_clean(gold_q, distinct_q, leakage.QUESTION_JACCARD_THRESHOLD), "an unrelated question must NOT flag"


def test_real_gold_is_clean_item_and_question_level():
    gold_texts, other_texts = leakage_hooks.assemble_inputs()
    assert len(gold_texts) >= 90 and len(other_texts) >= 100
    assert leakage.is_clean(gold_texts, other_texts, leakage.DEFAULT_JACCARD_THRESHOLD), \
        "the real gold set must be item-level CLEAN vs the training/synth corpus"
    gold_q, other_q = leakage_hooks.assemble_questions()
    assert leakage.is_clean(gold_q, other_q, leakage.QUESTION_JACCARD_THRESHOLD), \
        "no gold QUESTION may be a near-duplicate of a training question"
