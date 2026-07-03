# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Speech-to-text for the voice flashcards (doc 24 §8; Decision AF-2).

**Local ``faster-whisper`` is the default** — privacy-first, AI-OFF-safe, no key, zero network.
**Hosted OpenAI transcription is strictly opt-in** (``VOICE_STT_HOSTED=1`` + ``OPENAI_API_KEY``,
and never when ``AI_DISABLED=1``) and must be disclosed in-UI before any audio leaves the machine
(§5.6 voice privacy). Raw audio is transient: we transcribe and discard; only the transcript is
kept (AF-8).

Every failure path returns an honest ``STTResult`` with ``error`` set — never a fabricated
transcript, never a crash in the review loop. When no STT engine is available at all the UI hides
the mic and the type-instead path carries the whole experience (§15).

This module must not import the Anki engine (the ``ai/`` package wall).
"""

from __future__ import annotations

import importlib.util
import os
import tempfile
import threading
from dataclasses import dataclass
from typing import Any

# ~30s of speech is plenty for one flashcard answer; caps hosted-egress size too.
MAX_AUDIO_BYTES = 12 * 1024 * 1024

_local_model: Any = None  # lazily-loaded, cached faster-whisper model
_model_lock = threading.Lock()


def _model_dir() -> str:
    """Pinned local model directory — never an implicit HF cache (spec §7)."""
    configured = os.environ.get("VOICE_STT_MODEL_DIR", "").strip()
    if configured:
        return configured
    return os.path.join(os.path.expanduser("~"), ".cache", "charged-up", "whisper")


def _ensure_local_model() -> Any:
    """Lazily load the faster-whisper model once (lock prevents double-load)."""
    global _local_model
    with _model_lock:
        if _local_model is None:
            from faster_whisper import (  # type: ignore[import-not-found,import-untyped]
                WhisperModel,
            )

            model_size = os.environ.get("VOICE_STT_LOCAL_MODEL", "small")
            _local_model = WhisperModel(
                model_size,
                device="auto",
                compute_type="auto",
                download_root=_model_dir(),
            )
        return _local_model


def prewarm_async() -> None:
    """Warm the local model off the request thread (spec §10: first answer never pays load)."""
    if not local_available() or _local_model is not None:
        return
    threading.Thread(target=_warm_quietly, daemon=True).start()


def _warm_quietly() -> None:
    try:
        _ensure_local_model()
    except Exception:
        pass  # honest degrade at transcribe() time; prewarm never crashes anything


@dataclass
class STTResult:
    text: str
    confidence: float | None
    provider: str  # "local" | "openai" | "none"
    model: str
    error: str | None = None  # honest failure note; text is "" when set


def local_available() -> bool:
    """True when the offline engine (faster-whisper) is importable."""
    return importlib.util.find_spec("faster_whisper") is not None


def hosted_enabled() -> bool:
    """Hosted STT is OPT-IN only: the flag, a key, and the master AI kill-switch all agree."""
    if os.environ.get("AI_DISABLED", "0") == "1":
        return False
    if os.environ.get("VOICE_STT_HOSTED", "0") != "1":
        return False
    return bool(os.environ.get("OPENAI_API_KEY", "").strip())


def available() -> bool:
    return local_available() or hosted_enabled()


def _local_transcribe(audio_path: str, lang: str) -> STTResult:
    model = _ensure_local_model()
    model_size = os.environ.get("VOICE_STT_LOCAL_MODEL", "small")
    segments, info = model.transcribe(audio_path, language=lang, beam_size=5)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    confidence = getattr(info, "language_probability", None)
    return STTResult(
        text=text,
        confidence=float(confidence) if confidence is not None else None,
        provider="local",
        model=f"faster-whisper/{model_size}",
    )


def _hosted_transcribe(audio_path: str, lang: str) -> STTResult:
    # lazy; guarded by hosted_enabled(). The openai sdk is an optional opt-in dependency.
    from openai import OpenAI  # type: ignore[import-not-found,import-untyped]

    model = os.environ.get("VOICE_STT_HOSTED_MODEL", "gpt-4o-transcribe")
    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    with open(audio_path, "rb") as f:
        resp = client.audio.transcriptions.create(model=model, file=f, language=lang)
    return STTResult(
        text=(resp.text or "").strip(),
        confidence=None,
        provider="openai",
        model=model,
    )


def transcribe(
    audio_bytes: bytes, *, mime: str = "audio/webm", lang: str = "en"
) -> STTResult:
    """Transcribe one recorded answer. Local by default; hosted only when opted in.

    The audio is written to a temp file for the engine and deleted immediately after —
    discard-by-default (AF-8). Returns an honest ``error`` result on any failure.
    """
    if not audio_bytes:
        return STTResult("", None, "none", "", error="empty audio")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        return STTResult("", None, "none", "", error="recording too long")

    suffix = {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".m4a",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }.get(mime.split(";")[0].strip(), ".webm")

    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)
        if hosted_enabled():
            try:
                return _hosted_transcribe(path, lang)
            except Exception as exc:
                # Hosted opt-in failed → fall through to local if present, else report honestly.
                if not local_available():
                    return STTResult(
                        "", None, "openai", "", error=f"hosted STT failed: {exc}"
                    )
        if local_available():
            try:
                return _local_transcribe(path, lang)
            except Exception as exc:
                return STTResult(
                    "", None, "local", "", error=f"local STT failed: {exc}"
                )
        return STTResult(
            "",
            None,
            "none",
            "",
            error="no speech-to-text engine available — type your answer instead",
        )
    finally:
        # Discard-by-default: the raw audio never outlives the transcription call.
        try:
            os.unlink(path)
        except OSError:
            pass
