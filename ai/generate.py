# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Card generation entrypoint. The AI-OFF path makes ZERO network calls and never imports the live
client; the live path (sourced generation + verbatim-quote provenance gate) delegates to the
record/replay client (ai/client.py). Provider-neutral (OpenAI gpt-4o in the Friday build)."""

from __future__ import annotations

from dataclasses import dataclass, field

from . import config


@dataclass
class GenerationResult:
    cards: list = field(default_factory=list)
    ai_enabled: bool = False
    reason: str = ""


def generate_cards(source_text: str, source_id: str, n: int = 1, *, client=None) -> GenerationResult:
    """Generate up to `n` sourced MCAT cards from a source span.

    When AI is OFF, returns an empty result with a clear reason and touches NO network code (the live
    client module is not even imported). When ON, delegates to the record/replay client and gates every
    card on a VERBATIM quote from the source (the anti-hallucination provenance layer).
    """
    if not config.ai_enabled():
        return GenerationResult(
            cards=[],
            ai_enabled=False,
            reason="AI disabled (no ANTHROPIC_API_KEY/OPENAI_API_KEY, or AI_DISABLED=1) — no cards generated, no network call",
        )

    # Lazy imports so the AI-off path never loads any network/model/prompt code.
    from pathlib import Path

    from . import corpus_text
    from .client import AIClient

    try:
        from .sanitize import strip_hidden_text  # additive; present from W2a.6
    except ImportError:  # pragma: no cover - sanitize lands in W2a.6
        def strip_hidden_text(t):
            return t, {}

    clean, _flags = strip_hidden_text(source_text)
    system = (Path(__file__).resolve().parent / "prompts" / "generate_system.txt").read_text(encoding="utf-8")
    user = f"<source_chunk id={source_id!r}>\n{clean}\n</source_chunk>\nGenerate {n} MCAT Q&A cards."
    tool = {
        "name": "emit_cards",
        "description": "Emit MCAT flashcards, each with a verbatim supporting quote from the source.",
        "input_schema": {
            "type": "object", "additionalProperties": False, "required": ["cards"],
            "properties": {"cards": {"type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["question", "answer", "quote"],
                "properties": {"question": {"type": "string"}, "answer": {"type": "string"}, "quote": {"type": "string"}},
            }}},
        },
    }
    cli = client or AIClient(mode="record", cassette=Path(__file__).resolve().parent / "cassettes" / "generate.jsonl")
    max_tokens = max(1024, 80 * n + 256)
    resp = cli.message(system=system, user=user, tools=[tool],
                       tool_choice={"type": "tool", "name": "emit_cards"}, max_tokens=max_tokens)
    raw = ((resp.get("tool_use") or {}).get("input") or {}).get("cards", [])
    accepted: list = []
    rejected = 0
    for c in raw[:n]:
        card = {"question": (c.get("question") or "").strip(), "answer": (c.get("answer") or "").strip(),
                "source_id": source_id, "quote": (c.get("quote") or "").strip()}
        if card["question"] and card["answer"] and corpus_text.quote_in_source(clean, card["quote"]):
            accepted.append(card)
        else:
            rejected += 1
    return GenerationResult(cards=accepted, ai_enabled=True,
                            reason=f"generated {len(accepted)} accepted / {rejected} rejected (unsourced/empty)")
