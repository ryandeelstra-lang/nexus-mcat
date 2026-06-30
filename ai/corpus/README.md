# AI generation corpus (the "generation side" of the leakage wall)

The grounding corpus for **sourced** AI card generation. Every source here is **free public OER**
(OpenStax / Khan / LibreTexts / Wikipedia / PubMed) — see [`sources.jsonl`](sources.jsonl). **No real
AAMC items.** Every generated card must carry a `source_id` that resolves to a source in this registry
(the **C2 gate**, [`../provenance.py`](../provenance.py)); unsourced cards are blocked before any student
sees them.

This tree is **provenance-disjoint** from [`../../eval_gold/`](../../eval_gold/README.md) (the held-out
gold set) — the leakage wall (challenge 7e). The full corpus (synthesized ~1000+ items behind the wall) is
the F-AI.4 ~50-agent fan-out; `sources.jsonl` is the v1 source registry that pins the schema + the
free-public-source rule now.
