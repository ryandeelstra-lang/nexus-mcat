# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_c4_same_heldout.py
from ai.eval import split


def test_both_arms_score_the_identical_heldout_set():
    held = split.load_heldout()
    assert len(held) >= 50
    ids = [g["id"] for g in held]
    assert len(ids) == len(set(ids))              # the one held-out set both arms are scored on
