# The readiness score mapping (472–528)

This is the document `scores/display.py` cites in every readiness payload. It describes exactly
how the readiness number on the dashboard is produced, what it assumes, why it is stamped
**UNVALIDATED**, and what data would validate it. Implementation: `scores/readiness.py` (mirrored
on the phone in `ios-app/ScoreKit/Sources/ScoreKit/ScoreKit.swift` — if either changes, change both).

## What feeds the map (or nothing does)

The map runs **only** on a measured input: the published held-out performance eval
(`docs/release-proof/eval/performance-heldout.txt`, produced by `scripts/eval_performance.py`,
loaded by `scores/heldout.py`). If no eval artifact is present — or its held-out set is below the
20-item floor (`give_up.PERFORMANCE_MIN_ITEMS`) — readiness **abstains** with a structured reason.
It never maps a default, a guess, or a neutral prior. Independently, the give-up gate must already
be open: ≥ 1,000 graded reviews AND ≥ 75% of the 31 AAMC content categories covered
(`scores/give_up.py`).

## The method (linear, deliberately simple)

The MCAT total scale is 472–528: four sections, each scored 118–132.

1. **Section score.** Held-out accuracy `acc` (a 0–1 fraction of exam-style rewordings answered
   correctly) maps linearly onto one section: `section = 118 + (132 − 118) × acc`.
2. **Total point.** All four sections are assumed equal: `point = round(section × 4)`, clamped
   to [472, 528].
3. **Range.** The eval's bootstrap 90% interval `[acc_lo, acc_hi]` is pushed through the same
   linear map, then **widened by a coverage penalty**: `penalty = (1 − coverage) × (528 − 472) × 0.1`
   points on each side, where `coverage` is the fraction of the 31 content categories with any
   cards. Less of the exam seen ⇒ a wider, less confident band. Ends are clamped to [472, 528].
4. **Confidence label.** `low` below 90% coverage, `moderate` at or above it — never "high":
   the map itself is unvalidated.

## Assumptions (all of them are load-bearing)

- **Linearity.** Real MCAT scaled scoring is an equated, non-linear function of raw score that
  varies by test form. The linear map is a documented simplification, not psychometrics.
- **Uniform sections.** One aggregate accuracy stands in for all four sections; a lopsided
  student (e.g. strong C/P, weak CARS) is misrepresented by design until per-section evals exist.
- **The held-out set represents the exam.** The eval items are paraphrase rewordings of studied
  material — not AAMC items, not passage-based, and (currently) only n=24 of them.
- **The bootstrap CI is the only sampling uncertainty modeled.** Model misspecification is not
  in the band; the coverage penalty is a heuristic proxy for "unseen exam surface", with the 0.1
  factor chosen, not fitted.

## Why it is stamped UNVALIDATED

No output of this map has ever been compared against a real scored exam — no official AAMC
practice-test scores, no real test-day outcomes, from this user or anyone else. The inputs are
measured (that is the abstain rule above), but the *transformation* is an unvalidated convention.
Until validation data exists, every payload carries `note: "mapping UNVALIDATED against real
outcomes"` and the UI must surface it.

## What data would validate it

- **Anchor pairs:** the same student takes an official AAMC full-length practice exam near a
  dashboard readiness reading; collect (readiness point, scaled score) pairs across students and
  sessions.
- **Calibration check:** with ~30+ pairs, test whether the scaled score falls inside the stated
  range at the stated rate (a 90%-style band should contain ~90% of outcomes), and refit the
  section map (likely non-linear) from the pairs.
- **Per-section evals** (≥ 20 held-out items per section) to retire the uniform-sections
  assumption.

Until then: the point is a documented linear rescaling of one measured accuracy — useful as a
trend line, honest only alongside its range, coverage, and the UNVALIDATED stamp.
