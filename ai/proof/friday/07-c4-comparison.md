# C4 — our AI vs a keyword (BM25) baseline, same held-out set (n=56)

Both arms answer the identical 56 held-out gold questions and are graded IDENTICALLY.

## Primary metric — semantic answer-correctness (same LLM judge, both arms)

| arm | accuracy (judged correct-and-useful) |
|---|---|
| tuned BM25 keyword retrieval (k1=1.2, b=0.6) | 0.25 |
| our AI (gpt-4o) | 0.9107 |

**Winner: ai.**

## Secondary metric — lexical token-Jaccard >= 0.5 (transparency)

| arm | accuracy |
|---|---|
| tuned BM25 | 0.0 |
| our AI (gpt-4o) | 0.125 |

The lexical metric under-measures correctness (terse gold vs full-sentence answers), so it is
secondary; the AI wins under both. Keyword retrieval can only echo a stored card, so it cannot
answer a reworded held-out question it has no near-duplicate for — the gap the bridge must cross.
