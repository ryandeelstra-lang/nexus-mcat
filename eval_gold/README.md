# Grader calibration gold set (voice spec §8)

`spoken_gold.jsonl` — hand-labeled `{question, reference, transcript, label}` tuples
(`label ∈ good|okay|ask_again|dont_know`; `paraphrase: true` marks low-lexical-overlap
correct answers). Questions/references are drawn from the shipped `ai/corpus/cards/*.jsonl`;
transcripts are authored by hand to span verbatim, paraphrase, partial, wrong, blank, and
keyword-stuffed "cheese" cases.

This set lives behind the same leakage wall as the corpus (it restates card answers) — it is
an eval fixture, never shipped into a deck.

- **Lexical tier** (`test_lexical_floor_never_overshoots_into_a_false_pass`, AI-OFF, always run):
  the deterministic floor is downward-safe — it never mints a false GOOD from a wrong/blank
  answer, and overshoots by ≤10%. This is the property the AI-OFF path ships on.
- **Semantic tier** (`test_semantic_agreement_bar`, needs `ANTHROPIC_API_KEY`): must clear the
  pre-registered `SEMANTIC_AGREEMENT_BAR = 0.80` before the 90/70/40 cutoffs (and
  `SEMANTIC_HEADROOM`) are frozen. Retune the grader, never the bar. Not yet run — pending a key.
