# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.3: memory calibration + Brier on HELD-OUT, review_kind-filtered reviews (§6-Sunday / §9).
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_calibration.py

from scores import calibration


def _row(pred, success):
    return calibration.Row(card_id=1, predicted=pred, success=success)


def test_brier_is_zero_for_perfect_predictions():
    rows = [_row(1.0, True), _row(0.0, False), _row(1.0, True)]
    assert calibration.brier(rows) == 0.0


def test_brier_is_one_for_maximally_wrong():
    rows = [_row(1.0, False), _row(0.0, True)]
    assert calibration.brier(rows) == 1.0


def test_reliability_bins_group_by_decile():
    rows = [_row(0.05, False), _row(0.95, True), _row(0.92, True)]
    bins = calibration.reliability_bins(rows, k=10)
    filled = [b for b in bins if b.n > 0]
    assert filled and all(0.0 <= b.mean_predicted <= 1.0 for b in filled)
    assert sum(b.n for b in bins) == 3


def test_review_kind_filter_keeps_only_genuine_reviews():
    # (kind, button_chosen, last_interval_days) -> keep?
    LEARNING, REVIEW, RELEARNING, FILTERED, MANUAL = 0, 1, 2, 3, 4
    rows = [
        (MANUAL, 3, 5, 0),        # dropped: button-only convention still drops manual via kind
        (LEARNING, 3, 0, 0),      # dropped: sub-day learning step
        (FILTERED, 3, 2, 0),      # dropped: cram (ease_factor==0)
        (REVIEW, 3, 10, 2500),    # KEPT, success (button>1)
        (REVIEW, 1, 12, 2500),    # KEPT, failure (button==1)
    ]
    kept = calibration.filter_review_rows(rows)
    assert [(r_kind, btn) for (r_kind, btn, *_) in kept] == [(REVIEW, 3), (REVIEW, 1)]
    successes = [calibration.is_success(btn) for (_k, btn, *_) in kept]
    assert successes == [True, False]
