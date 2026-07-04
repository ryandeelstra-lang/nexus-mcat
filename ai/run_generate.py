# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Documented command: generate 50 cards from ONE real source, provenance-gated, and write the sidecar
+ a proof summary. LIVE (needs a model key, gated by W2a.1); records ai/cassettes/generate.jsonl.
Re-run with --replay to reproduce byte-identical output offline.

Chunks the source and accumulates distinct accepted cards across chunks (each chunk grounds its own
cards), deduping by normalized question and capping at the target. Every accepted card carries a
verbatim quote (the provenance gate in generate_cards blocks anything unsourced)."""
from __future__ import annotations
import json, sys
from pathlib import Path

from . import corpus_text
from .chunk import chunk_source
from .client import AIClient
from .generate import generate_cards
from .leakage import normalize
from .provenance import ProvenanceStore

AI = Path(__file__).resolve().parent
SOURCE_ID = "openstax-biology-2e.ch03"
TARGET = 50


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    mode = "replay" if "--replay" in argv else "record"
    text = corpus_text.load_source_text(SOURCE_ID)
    chunks = chunk_source(SOURCE_ID, text, size=1100, overlap=80)
    per_chunk = max(6, (TARGET // max(1, len(chunks))) + 6)
    cli = AIClient(mode=mode, cassette=AI / "cassettes" / "generate.jsonl")

    accepted: list = []
    seen: set = set()
    for ch in chunks:
        res = generate_cards(ch.text, SOURCE_ID, n=per_chunk, client=cli)
        for card in res.cards:
            key = normalize(card["question"])
            # Final provenance check against the FULL source (chunk slicing can cut a word at its edge,
            # so a quote word-aligned in a chunk may not be word-aligned in the whole source).
            if key and key not in seen and corpus_text.quote_in_source(text, card["quote"]):
                seen.add(key)
                accepted.append(card)
    cards = accepted[:TARGET]

    # C2 gate on real output: every shipped card's source_id MUST resolve to a named source in the
    # registry (not just carry the verbatim quote). Fails loudly rather than shipping an unsourced card.
    store = ProvenanceStore.from_jsonl(AI / "corpus" / "sources.jsonl")
    for c in cards:
        store.assert_sourced(c)

    (AI / "artifacts").mkdir(parents=True, exist_ok=True)
    with (AI / "artifacts" / "cards.jsonl").open("w", encoding="utf-8") as fh:
        for c in cards:
            fh.write(json.dumps(c) + "\n")
    summary = {"source_id": SOURCE_ID, "source_sha256": corpus_text.source_sha256(SOURCE_ID),
               "requested": TARGET, "accepted": len(cards), "distinct_questions": len(cards),
               "chunks": len(chunks), "per_chunk": per_chunk, "mode": mode,
               "note": "every card carries a verbatim source quote (provenance-gated); duplicates removed"}
    (AI / "proof" / "friday").mkdir(parents=True, exist_ok=True)
    (AI / "proof" / "friday" / "02-generation-summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if len(cards) >= 40 else 1


if __name__ == "__main__":
    raise SystemExit(main())
