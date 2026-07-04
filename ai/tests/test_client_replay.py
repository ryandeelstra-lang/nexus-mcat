# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
#   PYTHONPATH=. out/pyenv/bin/python -m pytest ai/tests/test_client_replay.py
import json, sys
from pathlib import Path

import pytest
from ai import client

FIX = Path(__file__).resolve().parent / "fixtures" / "tiny_cassette.jsonl"


def _write_cassette():
    payload = {"model": client.MODEL, "system": "S", "user": "U", "tools": [], "tool_choice": None}
    rec = {"request_hash": client.request_hash(payload),
           "response": {"stop_reason": "end_turn", "text": "hello", "tool_use": None}}
    FIX.parent.mkdir(parents=True, exist_ok=True)
    FIX.write_text(json.dumps(rec) + "\n", encoding="utf-8")


def test_replay_returns_recorded_response_and_touches_no_network():
    _write_cassette()
    c = client.AIClient(mode="replay", cassette=FIX)
    out = c.message(system="S", user="U")
    assert out["text"] == "hello" and out["stop_reason"] == "end_turn"
    assert "openai" not in sys.modules  # replay must NEVER import the SDK


def test_replay_miss_raises():
    _write_cassette()
    c = client.AIClient(mode="replay", cassette=FIX)
    with pytest.raises(client.CassetteMiss):
        c.message(system="different", user="different")


def test_request_hash_is_stable_and_order_independent():
    a = client.request_hash({"model": "m", "system": "s", "user": "u", "tools": [], "tool_choice": None})
    b = client.request_hash({"tool_choice": None, "user": "u", "tools": [], "system": "s", "model": "m"})
    assert a == b and len(a) == 64
