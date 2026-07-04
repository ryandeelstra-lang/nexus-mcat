# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. OPENAI_API_KEY=x out/pyenv/bin/python -m pytest ai/tests/test_generation_provenance_gate.py
from ai import chunk, generate


def test_chunker_is_deterministic_with_stable_ids():
    text = "abcdefghij" * 300  # 3000 chars
    a = chunk.chunk_source("src@v1", text, size=1200, overlap=100)
    b = chunk.chunk_source("src@v1", text, size=1200, overlap=100)
    assert [c.chunk_id for c in a] == [c.chunk_id for c in b]
    assert a[0].chunk_id == "src@v1#c0000" and a[0].source_id == "src@v1"
    assert text[a[1].start:a[1].end] == a[1].text  # offsets are exact


class _FakeClient:
    """Duck-typed client returning a canned tool_use response (no network)."""
    def __init__(self, cards):
        self._cards = cards
    def message(self, **_kw):
        return {"stop_reason": "tool_use", "text": "", "tool_use": {"name": "emit_cards", "input": {"cards": self._cards}}}


def test_generation_gates_on_verbatim_quote(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-fake")  # AI "enabled" so the live branch runs
    monkeypatch.delenv("AI_DISABLED", raising=False)
    source = "Glycolysis nets two ATP per glucose molecule in the cytosol."
    fake = _FakeClient([
        {"question": "Net ATP from glycolysis?", "answer": "Two ATP.", "quote": "nets two ATP per glucose"},
        {"question": "Hallucinated?", "answer": "Forty ATP.", "quote": "glycolysis nets forty ATP in the nucleus"},
    ])
    res = generate.generate_cards(source, "openstax-biology-2e.ch03", n=2, client=fake)
    assert res.ai_enabled is True
    assert len(res.cards) == 1                      # the fabricated-quote card is blocked
    assert res.cards[0]["source_id"] == "openstax-biology-2e.ch03"
    assert res.cards[0]["quote"] in source or "nets two ATP" in res.cards[0]["quote"]


def test_generation_off_returns_empty(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_DISABLED", raising=False)
    res = generate.generate_cards("anything", "src", n=3)
    assert res.ai_enabled is False and res.cards == []
