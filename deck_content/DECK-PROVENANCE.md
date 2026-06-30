# Deck content provenance (the "deck side" of the leakage wall)

Every card in [`cards.jsonl`](cards.jsonl) is **self-authored, original content** written from general
public scientific knowledge and worded from scratch for charged_up. Provenance tag: `self-authored-original`.

## Integrity guarantees (tier-1)

- **No real AAMC exam items**, no copied/scraped third-party question text, no copyrighted passage content.
  The cards test common, textbook-level facts in original wording (e.g. "net ATP yield of glycolysis").
- **Leakage wall (challenge 7e):** this `deck_content/` tree is provenance-DISJOINT from the held-out
  evaluation gold set in [`../eval_gold/`](../eval_gold/README.md). No gold item shares a `provenance_source`
  with any deck card, so a model trained/grounded on deck content can never have "seen" a gold answer.
  The leakage scanner (`ai/leakage.py`, built in Block F) enforces this structurally + lexically.
- Each card carries a taxonomy `leaf_id` (from [`docs/data/mcat_taxonomy.yaml`](../docs/data/mcat_taxonomy.yaml))
  so coverage (§7c) is computed against the frozen 31-content-category denominator.

## Schema (one JSON object per line)

`{ "leaf_id", "deck_path", "front", "back", "provenance": "self-authored-original" }`

The deck is built into a `.anki2` by [`../scripts/gen_mcat_deck.py`](../scripts/gen_mcat_deck.py). It is a
**tiny** seed deck (enough to demo the review loop + exercise the three scores); the full corpus is
synthesized separately under `ai/corpus/` (Block F) behind the same wall.
