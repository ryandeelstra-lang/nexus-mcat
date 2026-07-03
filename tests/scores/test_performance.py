# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.5: performance model — held-out exam-style accuracy beats a trivial baseline (§9 step 2).
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_performance.py

from scores import performance


def test_separable_data_beats_baseline():
    # recall strongly predicts correctness -> the logistic model must beat majority baseline.
    train = [(0.95, True), (0.9, True), (0.1, False), (0.05, False)] * 20
    held = [(0.92, True), (0.08, False)] * 20
    res = performance.evaluate_pairs(train, held)
    assert res["accuracy"] > res["baseline_accuracy"]
    assert 0.0 <= res["accuracy"] <= 1.0 and len(res["range"]) == 2


def test_aggregate_number_always_exists_even_if_small():
    res = performance.evaluate_pairs([(0.9, True), (0.1, False)], [(0.9, True)])
    assert "accuracy" in res and "wrong_rate" in res and res["n"] == 1
