# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Card generation entrypoint. The AI-OFF path makes ZERO network calls and never imports the live
client; the live path (sourced generation + provenance + checker) is built in F-AI.3 against recorded
responses and is PARKED until an ANTHROPIC_API_KEY is available."""

from __future__ import annotations

from dataclasses import dataclass, field

from . import config


@dataclass
class GenerationResult:
    cards: list = field(default_factory=list)
    ai_enabled: bool = False
    reason: str = ""


def generate_cards(source_text: str, source_id: str, n: int = 1) -> GenerationResult:
    """Generate up to `n` sourced MCAT cards from a source span.

    When AI is OFF, returns an empty result with a clear reason and touches NO network code (the live
    client module is not even imported). When ON, delegates to the live/record-replay client (F-AI.3).
    """
    if not config.ai_enabled():
        return GenerationResult(
            cards=[],
            ai_enabled=False,
            reason="AI disabled (no ANTHROPIC_API_KEY, or AI_DISABLED=1) — no cards generated, no network call",
        )
    # Lazy import so the AI-off path never loads any network/model code.
    raise NotImplementedError(
        "live AI generation (F-AI.3) is parked — build against recorded responses; "
        "set ANTHROPIC_API_KEY and implement ai/client.py with record/replay first"
    )
