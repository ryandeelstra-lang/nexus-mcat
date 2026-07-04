# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up F-AI.1: the AI is OFF by default — no key, no network, no engine import, scores still render.
# Run WITHOUT anki on PYTHONPATH so the no-engine-import assertion is meaningful:
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_ai_off.py

import socket
import sys

import ai  # noqa: F401  (importing the package must NOT pull in the engine)
from ai import config, generate


def test_ai_package_does_not_import_engine():
    offenders = [m for m in sys.modules if m == "anki" or m.startswith("anki.")]
    assert not offenders, f"the ai/ package must not import the Anki engine, but loaded: {offenders}"


def test_ai_off_by_default(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_DISABLED", raising=False)
    assert config.ai_enabled() is False  # no key (either provider) -> off


def test_ai_disabled_is_the_kill_switch(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    monkeypatch.setenv("AI_DISABLED", "1")
    assert config.ai_enabled() is False  # force-off even with a key present


def test_generate_off_makes_zero_network_calls(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_DISABLED", raising=False)

    def _blocked(*_a, **_k):
        raise AssertionError("the AI-off path attempted a network connection")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    result = generate.generate_cards("a source span about glycolysis", "src-1", n=2)
    assert result.ai_enabled is False
    assert result.cards == []
    assert "disabled" in result.reason.lower()
