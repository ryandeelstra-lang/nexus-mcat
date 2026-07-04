# Friday AI — what we built, why, and what we skipped

> instructions.md §6 (Friday desktop-AI) + §7f + §2. Every claim below is backed by a committed,
> replayable artifact in this directory (`ai/proof/friday/`) and a green test in `ai/tests/`.
> Model: **OpenAI `gpt-4o`** via a record/replay client (`ai/client.py`). Reproduce any number offline
> with `--replay` against the committed cassettes in `ai/cassettes/`.

## What we built

**A sourced, checked MCAT card generator** — the "AI added and checked" surface. It does one honest job:
turn ONE real open-license source into flashcards, and refuse anything it can't ground.

1. **Sourced generation (§2 pillar 1).** `ai/generate.py` reads OpenStax Biology 2e Ch.3 (CC BY 4.0,
   `ai/corpus/sources/openstax-biology-2e.ch03.txt`) and emits cards through a forced tool call. Every card
   carries a `source_id` **and** a `quote` that must be a **verbatim (normalized) substring of the source**
   (`ai/corpus_text.py::quote_in_source`). A card whose quote is fabricated is **blocked before it ships**.
   → 50 cards generated, all provenance-passing (`ai/artifacts/cards.jsonl`, `02-generation-summary.json`).

2. **A pre-serving held-out eval with a cutoff (§6, §7f).** The cutoff was **committed to git BEFORE the
   first run** (`ai/cutoff.json`, commit `409d622`, prior to the evidence commit `67b5d1a` — the pre-
   registration is the git history). The AI answerer answers only the **held-out** gold slice (disjoint from
   tune/dev, `ai/gold/split.json`) and its answers are graded into three buckets.
   → **accuracy 0.893, wrong-answer-rate 0.054, bad-teaching 3 (n=56) → PASS** (`06-eval-heldout.json`).

3. **The §7f card check (three counts, blocking cutoff).** `ai/checker.py` classifies each of the 50
   generated cards as correct-and-useful / wrong / correct-but-bad-teaching; anything not correct-and-useful
   is blocked from the shippable set.
   → **42 correct-and-useful / 2 wrong / 6 bad-teaching → PASS** (cutoff ≥40 & ≤3 wrong); 8 blocked
   (`05-cardcheck.json`).

4. **Beats a simpler method (§2 pillar 3).** `ai/run_c4.py` scores our AI against a tuned BM25 keyword
   baseline (`rank_bm25`, k1=1.2/b=0.6 on the dev split) on the **same** held-out set, graded IDENTICALLY.
   → **semantic (same LLM judge, primary): AI 0.875 vs BM25 0.25; lexical (transparency): AI 0.143 vs 0.0.**
   AI wins under both (`07-c4-baseline.json`, `07-c4-comparison.md`).

5. **Every AI output traces to a named source (§2 pillar 2).** Two gates run on real output: (a) the C2
   registry gate (`ai/provenance.py::assert_sourced`, wired into `run_generate`) proves every shipped card's
   `source_id` resolves to a named source in `ai/corpus/sources.jsonl` (the chapter id is registered), and
   (b) the verbatim-quote gate (`ai/corpus_text.py::quote_in_source`) requires the card's quote to be a
   **word-aligned** span of the source (a mid-word fragment like "fundament"→"fundamental" is rejected).
   The "AI claims with no traceable source → AI section = 0" cap is structurally impossible to trip.

6. **Safety rails.**
   - **AI-off still scores (§6, §7g):** `ai/config.py` defaults OFF; `AI_DISABLED=1` is a master kill
     switch; `scores/` imports nothing under `ai/` (AST-guarded, `test_ai_off_scores.py`); the off path
     opens zero sockets. (`01-ai-off-scores.txt`)
   - **Prompt injection (§10):** hidden HTML comments, `display:none` spans, and zero-width payloads are
     stripped/flagged (`ai/sanitize.py`) and the source is delimited data-not-instructions. Live proof over
     a hostile fixture: no `ATTACK` token escaped into any card (`03-injection.json`).
   - **Leakage (§7e):** the gold set is provenance-disjoint from corpus+deck (structural wall, primary) and
     the lexical near-copy scanner is **CLEAN over 96 gold × 4,678 training items** on TWO calibrated passes:
     item-level Q+A at 0.5 and question-level at 0.6 (`ai/leakage.py`). Thresholds were **calibrated against
     the real gold×corpus distribution**, not guessed — the genuine near-copy questions it surfaced (incl. a
     verbatim-identical stem) were reworded into distinct items; the residual overlap is shared canonical
     answers on independently-authored questions, which is not item leakage (`04-leakage-CLEAN.txt`,
     `04-gold-disjoint.json`). Note: this overlap could only ever help the BM25 baseline (which lost), never
     the AI answerer, which answers from the model and never reads the corpus.
   - **Reproducibility:** record/replay cassettes make every number re-derivable offline; the generation
     run reproduces byte-identical under `--replay`.

## Why these choices

- **Generate-and-check, not chat.** The brief rewards *checked* AI, so the whole surface is a gated
  pipeline (source → quote-gated generation → 3-bucket check → held-out eval → baseline), where the honest
  failure mode is *fewer cards*, never a wrong card served.
- **Provider-neutral, shipped on OpenAI `gpt-4o`.** The brief mandates a sourced/checked/beats-baseline AI,
  not a vendor. The configured key in this environment is OpenAI, and this repo already generates AI content
  via OpenAI, so we ship on `gpt-4o`; the client interface is provider-neutral (a localized swap enables the
  Anthropic path). See `ai/config.py`.
- **Semantic judge as the primary baseline metric.** Lexical token-overlap under-measures correctness for
  terse gold answers, so we grade both arms with the same LLM judge (fair, interpretable) and keep the
  lexical number for transparency. AI wins under both — so this is not metric-shopping.
- **Pre-registered cutoff in git.** The cutoff is committed before the run so the PASS is not back-fitted.

## What we skipped (and why)

- **Anthropic / Claude path** — parked (no Anthropic key configured). The client interface already supports
  it; swapping is a localized change. Not needed to satisfy the brief.
- **Vector (embedding) baseline** — the brief says "keyword *or* vector." We shipped the keyword (BM25)
  baseline; a vector baseline is a straightforward add if a second baseline is wanted.
- **Scaling generation to the full corpus** — we generated from ONE real source (as §7f asks). Fanning out
  across all registered OER sources is future work, gated by the same provenance wall.
- **Real-student calibration of downstream score models** — out of scope for the AI card surface; the score
  models are a separate workstream and abstain honestly rather than fabricate (§9 Step-4 bonus).

## Reproduce
```bash
export OPENAI_API_KEY=sk-...                                # a placeholder value is enough for --replay
                                                            # (clears the ai_enabled() gate; replay opens no socket)
.venv-ai/bin/python scripts/ai_preflight.py                 # gpt-4o smoke + deps (needs a REAL key)
.venv-ai/bin/python -m ai.run_generate --replay             # 50 sourced cards (offline, from cassette)
.venv-ai/bin/python -m ai.leakage                           # 7e wall CLEAN
.venv-ai/bin/python -m ai.run_cardcheck --replay            # 3 counts vs pre-registered cutoff
.venv-ai/bin/python -m ai.run_eval --split heldout --replay # held-out accuracy + wrong-rate
.venv-ai/bin/python -m ai.run_c4 --split heldout --replay   # AI vs BM25, same held-out set
PYTHONPATH=. AI_DISABLED=1 .venv-ai/bin/python -m pytest ai/tests/   # 78 pass, 1 skip
```
