# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Benchmark the voice-Keeper latency budgets (voice-Keeper spec §10).

Reports p50 / p95 / worst per stage — never one cherry-picked number:
  * lexical grade (a sanity floor; should be sub-millisecond)
  * local STT on a bundled short WAV fixture (scripts/bench_fixtures/answer5s.wav)
  * semantic grade (Claude round-trip; skipped without ANTHROPIC_API_KEY)

Budgets (asserted with --assert):
  * STT transcript-final (local `small`, dev machine): p95 < 2.5 s for <=15 s clips
  * semantic grade returned: p95 < 3 s

Usage:
  out/pyenv/bin/python scripts/bench_voice.py [--runs 20] [--assert]
"""

from __future__ import annotations

import argparse
import os
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURE = ROOT / "scripts" / "bench_fixtures" / "answer5s.wav"

STT_P95_BUDGET_S = 2.5
GRADE_P95_BUDGET_S = 3.0


def summarize(name: str, samples: list[float], budget: float | None) -> tuple[str, bool]:
    if not samples:
        return f"{name:24s}  (no samples)", True
    ordered = sorted(samples)
    p50 = statistics.median(ordered)
    idx95 = max(0, int(round(0.95 * (len(ordered) - 1))))
    p95 = ordered[idx95]
    worst = ordered[-1]
    line = f"{name:24s}  p50={p50 * 1000:8.1f}ms  p95={p95 * 1000:8.1f}ms  worst={worst * 1000:8.1f}ms"
    ok = True
    if budget is not None:
        ok = p95 < budget
        line += f"   budget p95<{budget:.1f}s -> {'OK' if ok else 'OVER'}"
    return line, ok


def bench_lexical(runs: int) -> list[float]:
    from ai import grade

    q = "What is the powerhouse of the cell?"
    ref = "The mitochondrion, which produces ATP through cellular respiration."
    ans = "The mitochondria make ATP through cellular respiration."
    samples = []
    for _ in range(runs):
        t0 = time.perf_counter()
        grade.grade_spoken(q, ref, ans)
        samples.append(time.perf_counter() - t0)
    return samples


def bench_stt(runs: int) -> list[float]:
    from ai import stt

    if not FIXTURE.exists() or not stt.local_available():
        return []
    audio = FIXTURE.read_bytes()
    stt.prewarm_async()
    time.sleep(2)  # let the prewarm land so the first timed run doesn't pay model load
    samples = []
    for _ in range(runs):
        t0 = time.perf_counter()
        stt.transcribe(audio, mime="audio/wav")
        samples.append(time.perf_counter() - t0)
    return samples


def bench_semantic(runs: int) -> list[float]:
    from ai import grade

    if not os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AI_DISABLED") == "1":
        return []
    q = "Define operant conditioning."
    ref = "Learning in which behavior is shaped by its consequences."
    ans = "Learning where rewards and punishments change how often you do something."
    samples = []
    for _ in range(min(runs, 8)):  # keep the API spend modest
        t0 = time.perf_counter()
        grade.grade_spoken(q, ref, ans)
        samples.append(time.perf_counter() - t0)
    return samples


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=20)
    parser.add_argument("--assert", dest="do_assert", action="store_true")
    args = parser.parse_args()

    results = [
        summarize("lexical grade", bench_lexical(args.runs), None),
        summarize("local STT (5s wav)", bench_stt(args.runs), STT_P95_BUDGET_S),
        summarize("semantic grade", bench_semantic(args.runs), GRADE_P95_BUDGET_S),
    ]
    print("voice-Keeper perf bench (spec §10)")
    print("=" * 72)
    all_ok = True
    for line, ok in results:
        print(line)
        all_ok = all_ok and ok
    if args.do_assert and not all_ok:
        print("\nFAIL: a stage is over its p95 budget", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
