# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_cutoff_blocks.py
import json
from pathlib import Path

CUTOFF = Path(__file__).resolve().parents[1] / "cutoff.json"


def test_cutoff_is_pre_registered_and_strict():
    c = json.loads(CUTOFF.read_text(encoding="utf-8"))
    assert c["min_correct_and_useful"] == 40 and c["max_wrong"] == 3 and c["n"] == 50
    assert c["committed"] and c["registered_in"]  # must name the git-committed timestamp + decision


def test_pass_fail_logic():
    from ai.run_cardcheck import passes_cutoff
    assert passes_cutoff({"correct-and-useful": 45, "wrong": 2, "correct-but-bad-teaching": 3}) is True
    assert passes_cutoff({"correct-and-useful": 39, "wrong": 2, "correct-but-bad-teaching": 9}) is False  # below 40
    assert passes_cutoff({"correct-and-useful": 44, "wrong": 4, "correct-but-bad-teaching": 2}) is False  # >3 wrong
