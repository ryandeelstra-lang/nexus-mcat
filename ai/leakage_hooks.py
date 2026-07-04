# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Assemble the 7e scanner input: gold (held-out side) vs the training/synth corpus + generated cards
(training side). The gold provenance_source is INTENTIONALLY excluded from training — never leakage."""
from __future__ import annotations
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GOLD = REPO / "eval_gold" / "cardcheck_gold.jsonl"
CORPUS_CARDS = REPO / "ai" / "corpus" / "cards"
DECK = REPO / "deck_content" / "cards.jsonl"
GENERATED = REPO / "ai" / "artifacts" / "cards.jsonl"


def _lines(path: Path):
    return [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()] if path.exists() else []


def assemble_inputs() -> tuple:
    gold = []
    for l in _lines(GOLD):
        d = json.loads(l)
        gold.append(f"{d['question']} {d['gold_answer']}")
    other = []
    for f in sorted(CORPUS_CARDS.glob("*.jsonl")):
        for l in _lines(f):
            d = json.loads(l)
            other.append(f"{d.get('front', '')} {d.get('back', '')}")
    for l in _lines(DECK):
        d = json.loads(l)
        other.append(f"{d.get('front', '')} {d.get('back', '')}")
    for l in _lines(GENERATED):
        d = json.loads(l)
        other.append(f"{d.get('question', '')} {d.get('answer', '')}")
    return gold, other


def assemble_questions() -> tuple:
    """QUESTION-only inputs for the question-level near-duplicate pass: gold questions vs training
    questions (corpus fronts, deck fronts, generated questions). A leaked test ITEM shows up here as a
    near-duplicate stem even when the canonical answer differs."""
    gold_q = [json.loads(l)["question"] for l in _lines(GOLD)]
    other_q = []
    for f in sorted(CORPUS_CARDS.glob("*.jsonl")):
        for l in _lines(f):
            other_q.append(json.loads(l).get("front", ""))
    for l in _lines(DECK):
        other_q.append(json.loads(l).get("front", ""))
    for l in _lines(GENERATED):
        other_q.append(json.loads(l).get("question", ""))
    return gold_q, other_q
