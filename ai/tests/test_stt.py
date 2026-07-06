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


def test_model_dir_pinned(monkeypatch, tmp_path):
    """The local model loads from a pinned download_root, never an implicit HF cache."""
    captured = {}

    class FakeModel:
        def __init__(self, size, device, compute_type, download_root):
            captured["download_root"] = download_root

        def transcribe(self, path, language, beam_size, **kwargs):
            class Info:
                language_probability = 0.9

            class Seg:
                text = "hello"

            return [Seg()], Info()

    import sys
    import types

    monkeypatch.setenv("VOICE_STT_MODEL_DIR", str(tmp_path / "models"))
    monkeypatch.setattr(stt, "_local_model", None)
    monkeypatch.setattr(stt, "local_available", lambda: True)
    monkeypatch.setattr(stt, "hosted_enabled", lambda: False)
    fake_mod = types.ModuleType("faster_whisper")
    fake_mod.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_mod)
    # Request paths never lazy-load (see test below) — warm the model the way
    # prewarm_async does, then transcribe.
    stt._ensure_local_model()
    result = transcribe(b"RIFFxxxx", mime="audio/wav")
    assert result.text == "hello"
    assert captured["download_root"] == str(tmp_path / "models")


def test_transcribe_never_lazy_loads_on_request_path(monkeypatch):
    """A grade request must not trigger the model load (a ~463MB download under the
    model lock would wedge every server worker) — it answers honestly instead."""

    class ExplodingModel:
        def __init__(self, *a, **k):
            raise AssertionError("request path must not construct the model")

    import sys
    import types

    monkeypatch.setattr(stt, "_local_model", None)
    monkeypatch.setattr(stt, "local_available", lambda: True)
    monkeypatch.setattr(stt, "hosted_enabled", lambda: False)
    # Neutralize the background warm the honest path kicks off, so the fake
    # module can't be constructed off-thread mid-test either.
    monkeypatch.setattr(stt, "prewarm_async", lambda: None)
    fake_mod = types.ModuleType("faster_whisper")
    fake_mod.WhisperModel = ExplodingModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_mod)
    result = transcribe(b"RIFFxxxx", mime="audio/wav")
    assert result.text == ""
    assert result.error is not None and "warming up" in result.error


def test_local_decode_pins_determinism(monkeypatch):
    """The Keeper's runthrough must transcribe the same audio the same way every time:
    faster-whisper's default temperature fallback ladder ([0.0..1.0] — it SAMPLES when the
    quality gates fail) and cross-segment conditioning are pinned off."""
    import sys
    import types

    captured: dict[str, object] = {}

    class FakeModel:
        def __init__(self, *a, **k):
            pass

        def transcribe(self, path, language, beam_size, **kwargs):
            captured.update(kwargs, language=language, beam_size=beam_size)

            class Info:
                language_probability = 0.9

            class Seg:
                text = "same every time"

            return [Seg()], Info()

    fake_mod = types.ModuleType("faster_whisper")
    fake_mod.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_mod)
    monkeypatch.setattr(stt, "_local_model", None)
    monkeypatch.setattr(stt, "local_available", lambda: True)
    monkeypatch.setattr(stt, "hosted_enabled", lambda: False)
    stt._ensure_local_model()
    result = transcribe(b"RIFFxxxx", mime="audio/wav")
    assert result.text == "same every time"
    assert captured["temperature"] == 0.0
    assert captured["condition_on_previous_text"] is False


def test_prewarm_async_loads_model_once(monkeypatch):
    """The lazy loader is lock-guarded — concurrent callers load the model exactly once."""
    import sys
    import threading
    import types

    loads = []

    class FakeModel:
        def __init__(self, *a, **k):
            loads.append(1)

    fake_mod = types.ModuleType("faster_whisper")
    fake_mod.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", fake_mod)
    monkeypatch.setattr(stt, "_local_model", None)
    monkeypatch.setattr(stt, "local_available", lambda: True)
    threads = [threading.Thread(target=stt._ensure_local_model) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(loads) == 1
    stt.prewarm_async()  # smoke: must not raise even when already warm
