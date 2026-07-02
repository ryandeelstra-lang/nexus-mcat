# Eval gold set (the "held-out side" of the leakage wall)

This tree holds the **held-out evaluation gold set** — known-answer items used ONLY to score models
(memory calibration, the AI card-checker, the held-out accuracy eval). It is **provenance-disjoint** from
[`../deck_content/`](../deck_content/DECK-PROVENANCE.md) and from the generation corpus (`ai/corpus/`).

## The leakage wall (challenge 7e — a hard limit; leaked test data zeroes the score)

1. **Structural wall (primary):** every gold item carries a `provenance_source` drawn from a source NOT used
   by any deck card or any corpus item. The set of gold `provenance_source`s ∩ (deck ∪ corpus) `provenance_source`s
   MUST be empty. This is asserted in code before any eval reads a number.
2. **Lexical/semantic backstop:** `ai/leakage.py` (Block F) flags any near-duplicate (normalized exact-match
   - token-Jaccard above a pre-registered, distribution-calibrated threshold, with an embedding backstop)
     between gold and (deck ∪ corpus ∪ generated cards). A bare "0 leaks" from an uncalibrated threshold does
     NOT satisfy the gate (hardening M8).
3. **Read-once held-out split:** the held-out partition is read exactly once for the reported numbers; tuning
   happens on disjoint tune/dev partitions (`ai/gold/split.json`).

The gold items themselves are authored/curated in Block F (F-AI.4) — this README pins the wall contract now,
before any eval item exists, so nothing can be authored on the wrong side of it.
