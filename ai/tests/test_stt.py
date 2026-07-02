# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# Voice flashcards (doc 24 §8/§17): STT is local-default, hosted opt-in, discard-by-default, and
# honest on every failure. Run out-of-process:
#   out/pyenv/bin/python -m pytest ai/tests/test_stt.py

from __future__ import annotations

import ai.stt as stt
from ai.stt import STTResult, transcribe


def test_stt_module_does_not_import_engine():
    import sys

    assert "anki.collection" not in sys.modules


def test_hosted_disabled_by_default(monkeypatch):
    monkeypatch.delenv("VOICE_STT_HOSTED", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    assert stt.hosted_enabled() is False  # opt-in flag required, not just a key


def test_hosted_off_when_ai_disabled(monkeypatch):
    monkeypatch.setenv("VOICE_STT_HOSTED", "1")
    monkeypatch.setenv("OPENAI_API_KEY", "k")
    monkeypatch.setenv("AI_DISABLED", "1")
    assert stt.hosted_enabled() is False  # master kill-switch wins


def test_hosted_needs_a_key(monkeypatch):
    monkeypatch.setenv("VOICE_STT_HOSTED", "1")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("AI_DISABLED", raising=False)
    assert stt.hosted_enabled() is False


def test_empty_audio_is_honest_error():
    r = transcribe(b"")
    assert isinstance(r, STTResult)
    assert r.text == "" and r.error == "empty audio" and r.provider == "none"


def test_oversized_audio_is_rejected():
    r = transcribe(b"x" * (stt.MAX_AUDIO_BYTES + 1))
    assert r.error == "recording too long" and r.text == ""


def test_no_engine_available_is_honest(monkeypatch):
    # No local engine, hosted not opted in → honest "type instead", never a fake transcript.
    monkeypatch.setattr(stt, "local_available", lambda: False)
    monkeypatch.setattr(stt, "hosted_enabled", lambda: False)
    r = transcribe(b"some-bytes", mime="audio/webm")
    assert r.provider == "none"
    assert r.text == ""
    assert r.error and "type your answer" in r.error


def test_audio_is_discarded_after_local_transcribe(monkeypatch):
    # Discard-by-default (AF-8): the temp file must not survive the call.
    seen: dict[str, str] = {}

    def fake_local(path: str, lang: str) -> STTResult:
        import os

        seen["path"] = path
        assert os.path.exists(path)  # present DURING transcription
        return STTResult("hello", 0.99, "local", "faster-whisper/small")

    monkeypatch.setattr(stt, "local_available", lambda: True)
    monkeypatch.setattr(stt, "hosted_enabled", lambda: False)
    monkeypatch.setattr(stt, "_local_transcribe", fake_local)

    r = transcribe(b"audio-bytes", mime="audio/webm")
    assert r.text == "hello" and r.provider == "local"

    import os

    assert not os.path.exists(seen["path"])  # deleted after (raw audio not retained)


def test_hosted_failure_falls_back_to_local(monkeypatch):
    monkeypatch.setattr(stt, "hosted_enabled", lambda: True)
    monkeypatch.setattr(stt, "local_available", lambda: True)

    def boom(path, lang):
        raise RuntimeError("network down")

    monkeypatch.setattr(stt, "_hosted_transcribe", boom)
    monkeypatch.setattr(
        stt,
        "_local_transcribe",
        lambda p, l: STTResult("local text", None, "local", "fw/small"),
    )
    r = transcribe(b"bytes")
    assert r.provider == "local" and r.text == "local text"
