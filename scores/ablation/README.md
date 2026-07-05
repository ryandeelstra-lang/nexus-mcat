# §8 three-build interleaving ablation — pre-registration freeze

This file completes the pre-registration for the three-build interleaving ablation
(challenge §8; requirements G1–G3, D4–D5). It is committed **before any simulation run**;
the git date of this commit is the proof. Nothing in this file may be edited after the
first result exists (append-only thereafter).

## 1. What was already frozen (git-dated 2026-06-30, planning repo commit `4605174`)

Quoted verbatim from `docs/04-PLAN.md` step 0.10 (planning repo, committed 2026-06-30 in
`4605174`; mechanism per Decision 4, `docs/05-DECISIONS.md:43`, dated 2026-06-29):

- **HYPOTHESIS** — "Interleaving related MCAT topics (Random order) yields higher held-out
  mixed-topic quiz accuracy than blocking (DeckThenDay) at an equal study-time budget."
- **MAIN METRIC** — mean held-out mixed-topic quiz accuracy after a fixed simulated-study
  budget, identical card budget across builds.
- **FAILURE CRITERION (verbatim)** — "Failed if FULL ≤ ABLATION at the same budget;
  CI overlapping zero = no effect, reported honestly."
- Paired design, N≥200 seeds, bootstrap 90% CI as the range, null/negative valid (D5).
- **Mechanism (Decision 4)** — the feature under ablation is exactly two deck-config fields:
  `review_order` = `Random`(8) vs `DeckThenDay`(2) and `new_card_gather_priority` =
  `RandomCards`(4) vs `Deck`(0). Nothing else differs between FULL and ABLATION.

Step 0.10 also required freezing the confusability parameter "as a literature-cited RANGE
(not a point), each endpoint with a source". That range was never written into the decision
log — **this file closes that gap** (§2), dated before the first run.

## 2. THE FROZEN CONFUSABILITY RANGE

**κ (confusability)** is the probability that, on a held-out mixed-topic quiz item, an
undiscriminated confusable neighbor topic captures the learner's response (a
cross-topic discrimination error), before any discrimination training. Formally, quiz
item success probability is `p = g + (1−g) · K_t · (1 − κ·(1−D))` (see §4).

**Frozen range: κ ∈ [0.0, 0.6]. Frozen sweep grid: {0.0, 0.2, 0.4, 0.6}.**

- **Lower endpoint κ = 0.0** — topics with no mutual confusability. For low-similarity
  category structures the interleaving advantage is predicted to vanish (blocked study
  generalized *better* for low-similarity structures: Carvalho & Goldstone 2014,
  *Memory & Cognition* 42(3):481–495). κ=0 doubles as the in-sweep **null control**
  (docs/04-PLAN.md SU2: "keep discriminability=0 as the in-sweep null control").
- **Upper endpoint κ = 0.6** — a deliberately conservative cap **below** the single direct
  literature estimate. Taylor & Rohrer 2010 (*Applied Cognitive Psychology* 24(6):837–848)
  report that after blocked practice of four confusable prism formulas, 46% of test
  problems drew discrimination errors vs 15% fabrication errors — i.e. ≈0.75 of the
  blocked group's failures were cross-category confusions. Rohrer & Taylor 2007
  (*Instructional Science* 35(6):481–498) corroborate: "virtually every test error was due
  to the selection of the wrong formula" (blocked test accuracy 20% vs 63% interleaved at
  one week). Capping at 0.6 < 0.75 means the sweep cannot overstate the mechanism relative
  to the one direct measurement; it can only understate it.
- Mechanism justification for *why* interleaving should raise discrimination at all:
  discriminative-contrast — temporal juxtaposition of exemplars from different categories
  enables between-category comparison (Kang & Pashler 2012, *Applied Cognitive Psychology*
  26(1):97–103, who deconfounded it from spacing; Kornell & Bjork 2008, *Psychological
  Science* 19(6):585–592).

Citations were independently verified against the primary sources on 2026-07-05 before
this freeze (Rohrer & Taylor 2007 title is often mis-cited, including by Rohrer's own later
papers; the published title is "The shuffling of mathematics problems improves learning").

## 3. THE THREE ARMS (all differences enumerated)

All arms: same fresh collection recipe, same 96-card study pool, same held-out quiz, same
learner (same seed), same daily time cap, FSRS enabled, all other deck-config values at
upstream defaults (`new.perDay=20`, `rev.perDay=200`, `new.delays=[1.0,10.0]`).

| arm | review_order | new_card_gather_priority | meaning |
|---|---|---|---|
| FULL | Random (8) | RandomCards (4) | shipped feature ON — interleaved |
| ABLATION | DeckThenDay (2) | Deck (0) | same app, feature OFF — blocked |
| PLAIN | Day (0) = upstream default | Deck (0) = upstream default | unmodified Anki baseline |

PLAIN differs from ABLATION: upstream's default review order is `Day` (due day, then a
deterministic per-day shuffle within the day), which already mixes decks *within* a due
day — so plain Anki is expected to sit between FULL and ABLATION on incidental
interleaving. This PLAIN-vs-ABLATION difference is reported per SU2. FSRS is enabled in
all three arms (a stock upstream option) so memory dynamics are held constant and study
ORDER is the only manipulated variable; this is a deliberate, documented control.

## 4. SIMULATED LEARNER (order-agnostic; frozen constants)

The scheduler is the **real engine** driven through pylib (`get_queued_cards` →
`build_answer` → `answer_card`); no scheduling logic is reimplemented. The learner model
never reads the arm name — it sees only the card sequence the engine serves:

- **Memory ground truth = FSRS.** Recall probability of a seen card = the FSRS-6
  forgetting curve `r = (elapsed_days/S · factor + 1)^(−decay)`, `factor = 0.9^(1/−decay) − 1`,
  on the **engine-stored** stability S and decay (fsrs 5.2.0 `inference.rs:60-63`; a
  pinning test asserts this mirror matches `col.card_stats_data(cid).fsrs_retrievability`).
  Recall derives from stability/retrievability, NOT from study order (T7).
- **First exposure**: a brand-new card is answered Good with probability p0 = 0.30, else
  Again. Only ratings Good/Again are ever used.
- **Same-day re-serves** (learning/relearning steps re-served within one simulated day)
  have day-granular elapsed = 0 → r = 1 → always pass ("you saw the answer minutes ago").
- **Discrimination D** accrues ONLY from the observed sequence: a *contrast event* for a
  confusable topic pair {t,t′} is two **consecutively served** presentations, one from t
  and one from t′ (adjacency window = 1, the strict discriminative-contrast reading of
  Kang & Pashler 2012; within-day only). `D_pair = 1 − (1−η)^n_contrast` with **η = 0.02**,
  fixed a priori. For any η > 0, more contrast events ⇒ larger D, so η's exact value
  scales but cannot flip the sign of the FULL−ABLATION difference.
- **Held-out quiz** (disjoint from study items by construction: quiz items are synthetic
  per-topic probes, not cards): success probability
  `p = g + (1−g) · K_t · (1 − κ·(1−D_pair(t)))`, guess floor **g = 0.25** (4-option MCQ),
  `K_t` = mean mirrored FSRS retrievability over topic t's studied cards at quiz time.
  Study-phase answers carry no confusability penalty (during study the deck/topic context
  is visible; discrimination is only demanded by the mixed held-out quiz).
- **Common random numbers**: every stochastic draw is a SHA-256 hash of
  (master seed, learner, card/item, repetition) — identical across arms, maximizing
  pairing. Master seed **20260705**.

## 5. DESIGN CONSTANTS (frozen)

- 8 topics in 4 confusable pairs (T01,T02),(T03,T04),(T05,T06),(T07,T08); adjacent decks,
  which is *generous to blocking* (deck-boundary transitions are contrast events).
- 12 study cards per topic (96 total); 5 held-out quiz items per topic (40 total).
- 14 simulated study days; quiz on day 14.
- Equal per-day study-time cap: **3600 s/day**, every arm. Review time cost: 12 s per
  correct answer, 25 s per failure. The cap is sized so every arm normally clears its
  daily queue (the equal-budget claim is the equal cap; per-arm utilization and any
  budget-capped days are reported — expected 0).
- N = 200 simulated learners (pre-registered N≥200), paired across arms.
- Bootstrap: 10,000 percentile resamples of the 200 paired per-learner differences,
  seeded; 90% CI.
- **Null-control criterion (frozen pre-run):** at κ=0 the confusability mechanism is off,
  so the FULL−ABLATION difference measures only residual engine-pathway noise
  (new-card introduction-day permutation). Pre-registered check: |paired diff at κ=0|
  ≤ 0.01 (practical-equivalence bound), with its bootstrap CI reported alongside.
- Verdict rule: the frozen FAILURE CRITERION quoted verbatim in §1, applied per sweep
  point; the overall verdict is the honest conditional ("effect appears for κ ≥ X, with
  X shown"); null/negative reported as full-value results.

## 6. Determinism architecture (why reruns are byte-identical)

- Note/card ids and `mod` timestamps are normalized to fixed constants at setup and at
  each day boundary (they are wall-clock-derived otherwise, and the engine's Random
  review order is the deterministic hash `fnvhash(id, mod)`; new-card RandomCards gather
  is `fnvhash(id, knuth_salt(days_elapsed))` — `rslib/src/storage/card/mod.rs:823,928`).
- `answered_at_millis` is stamped explicitly per answer at day-exact simulated times
  (BASE + day·86400 s), so revlog ids, `last_review_time`, and FSRS elapsed times are
  exact whole days and identical across arms and across reruns.
- Day advance = shift `col.crt` back 86400 s then close+reopen the collection (reopening
  is mandatory: the cached scheduler timing otherwise corrupts scheduling — probe-verified).
- `ANKI_TEST_MODE=1` disables interval fuzz and the load-balancer RNG
  (`rslib/src/scheduler/answering/mod.rs:662-668`).
- Interval-timing guard: the run aborts cleanly if started within 30 minutes of the 4 AM
  day rollover (and should not be run 02:00–04:00 local, where ANKI_TEST_MODE shifts the
  backend clock).
- The report contains no wall-clock timestamps, hostnames, or absolute paths.
- Worker parallelism (`--jobs`) cannot affect results: outputs are keyed by
  (learner, arm) and reassembled in fixed order.

## 7. Scope and limits (tier-3)

This is a **MECHANISM DEMONSTRATION on simulated learners, NOT a measured human effect**.
The scheduler, queue building, FSRS memory updates, and daily limits are the real engine;
the learner (recall draws, first-exposure rate, discrimination accrual, quiz model) is a
simulation whose confusability range was frozen from the literature before the run.
No real longitudinal human cohort exists within this project's timeline (§9
acknowledgment). Simulator output is CONFINED to the ablation report
(`docs/release-proof/eval/ablation.txt`); it never feeds `scores/display.py`,
`scores/readiness.py`, or any user-facing score.

## 8. Amendments 2026-07-05 (before the first artifact run)

Implementation of §6 surfaced two engine facts that required architecture
fixes. Both were found via single-arm smoke/diagnostic probes; **no sweep,
artifact, or per-arm accuracy comparison had been run** when these were
committed, and no frozen mechanism parameter (κ range, η, g, p0, costs,
budget, N, seeds) changed.

1. **Learn-ahead serve order is wall-clock-fragile.** The engine stamps
   intraday (re)learning step dues at real-wall-clock **second** granularity
   (`CardStateUpdater.now = TimestampSecs::now()`,
   `rslib/src/scheduler/answering/mod.rs:523`), so which failed cards tie
   within the same second — and therefore their learn-ahead serve order —
   varied between otherwise identical runs. Fix: the simulated session
   **never serves future-due learn-ahead cards**; step timers roll overnight
   and pending step dues are re-normalized to deterministic id-ordered
   constants at each day boundary. §4's "same-day re-serves have elapsed 0 →
   always pass" is therefore moot: there are no same-day re-serves; pending
   steps are re-served the next morning at whole-day elapsed like every other
   card.
2. **FSRS elapsed ignores answered_at.** The FSRS stability update computes
   `days_elapsed = timing.next_day_at.elapsed_days_since(last_review_time)`
   (INTEGER days, anchored at the next real rollover —
   `rslib/src/scheduler/answering/mod.rs:480-487`, `timestamp.rs:31-33`), so
   §6's original fixed-epoch stamping made every gap read as ~6 months.
   Fix — "age the collection": answers are stamped one hour into the current
   real sched day, and at each simulated day boundary the harness shifts
   `last_review_time` (cards.data `lrt`) back 86400 s and revlog ids back
   86400000 ms while `crt` advances `today`. Every FSRS elapsed is then an
   exact whole number of days — identical across arms, run dates, and times
   of day — and prior days never count against the daily limits. The
   learner's mirror curve uses the same whole-day elapsed, from the harness's
   own last-reviewed-day ledger.

## 9. How to run

From the repo root (requires the built `out/` tree):

    PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python scripts/eval_ablation.py

writes `docs/release-proof/eval/ablation.txt` and prints it. Equivalent canonical entry
point (used by the planned eval_all chain): `scores/ablation/run.py`. Unit tests
(`tests/scores/test_ablation.py`) use a reduced-size configuration for CI speed; the
artifact run uses the full frozen constants above. Re-running with the same master seed
reproduces the artifact byte-identically.
