# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""The discrete 7f card checker: classify each generated card into one of three classes via a strict
structured-output tool, and BLOCK anything not correct-and-useful. Rubric authored on the tune split;
scored against the held-out split (W2a.9)."""
from __future__ import annotations
from pathlib import Path

CLASSES = ("correct-and-useful", "wrong", "correct-but-bad-teaching")
_SYSTEM = (Path(__file__).resolve().parent / "prompts" / "checker_system.txt")
_TOOL = {
    "name": "classify",
    "description": "Classify one MCAT flashcard.",
    "input_schema": {
        "type": "object", "additionalProperties": False, "required": ["label", "wrong_subreason"],
        "properties": {
            "label": {"type": "string", "enum": list(CLASSES)},
            "wrong_subreason": {"type": ["string", "null"],
                                "description": "one of factually-wrong / contradicts-cited-source / "
                                               "contradicts-accepted-pair, or null when not wrong"},
        },
    },
}


def check_card(card: dict, *, client, source_text: str) -> dict:
    system = _SYSTEM.read_text(encoding="utf-8")
    user = (f"<card>\nQ: {card['question']}\nA: {card['answer']}\n</card>\n"
            f"<cited_span>{card.get('quote', '')}</cited_span>")
    resp = client.message(system=system, user=user, tools=[_TOOL], tool_choice={"type": "tool", "name": "classify"})
    inp = ((resp.get("tool_use") or {}).get("input") or {})
    label = inp.get("label")
    if label not in CLASSES:  # schema/refusal failure -> treat as wrong, never silently accept
        return {"class": "wrong", "wrong_subreason": "factually-wrong"}
    return {"class": label, "wrong_subreason": inp.get("wrong_subreason")}


def run_checker(cards: list, *, client, source_text: str) -> dict:
    counts = {c: 0 for c in CLASSES}
    accepted, blocked = [], []
    for card in cards:
        verdict = check_card(card, client=client, source_text=source_text)
        counts[verdict["class"]] += 1
        if verdict["class"] == "correct-and-useful":
            accepted.append(card)
        else:
            blocked.append({**card, **verdict})
    return {"counts": counts, "accepted": accepted, "blocked": blocked}
