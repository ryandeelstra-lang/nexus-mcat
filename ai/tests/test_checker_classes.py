# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_checker_classes.py
from ai import checker


class _FakeClient:
    """Returns a canned classification keyed by the card's answer text."""
    def __init__(self, mapping):
        self._m = mapping
    def message(self, *, user, **_kw):
        for needle, cls in self._m.items():
            if needle in user:
                sub = "factually-wrong" if cls == "wrong" else None
                return {"stop_reason": "tool_use", "text": "",
                        "tool_use": {"name": "classify", "input": {"label": cls, "wrong_subreason": sub}}}
        return {"stop_reason": "tool_use", "text": "", "tool_use": {"name": "classify", "input": {"label": "wrong", "wrong_subreason": "factually-wrong"}}}


def test_three_classes_and_blocking():
    src = "Glycolysis nets two ATP per glucose in the cytosol."
    cards = [
        {"question": "Net ATP?", "answer": "Two ATP.", "source_id": "s", "quote": "nets two ATP"},
        {"question": "Net ATP?", "answer": "Forty ATP.", "source_id": "s", "quote": "nets two ATP"},
        {"question": "ATP?", "answer": "It is a molecule.", "source_id": "s", "quote": "atp"},
    ]
    fake = _FakeClient({"Two ATP.": "correct-and-useful", "Forty ATP.": "wrong",
                        "It is a molecule.": "correct-but-bad-teaching"})
    res = checker.run_checker(cards, client=fake, source_text=src)
    assert res["counts"] == {"correct-and-useful": 1, "wrong": 1, "correct-but-bad-teaching": 1}
    accepted_answers = {c["answer"] for c in res["accepted"]}
    assert accepted_answers == {"Two ATP."}                    # only correct-and-useful survives
    assert len(res["blocked"]) == 2                            # wrong + bad-teaching blocked
