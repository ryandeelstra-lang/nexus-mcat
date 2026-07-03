#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""charged_up: perf bench for the voice-Keeper pipeline (voice spec §10).

Reports p50/p95/worst (never one cherry-picked number) for each stage that can run headless:
  * lexical grade  — the AI-OFF deterministic floor (sanity; must be sub-millisecond)
  * local STT      — faster-whisper on a bundled fixture WAV (skipped if deps/fixture absent)
  * semantic grade — the Claude judge round-trip (skipped without ANTHROPIC_API_KEY)

Budgets (spec §10), asserted with --assert:
  * lexical grade  p95 <   50 ms
  * local STT      p95 < 2500 ms   (≤15s clip, dev machine, `small` model)
  * semantic grade p95 < 3000 ms

Usage:
    PYTHONPATH=out/pylib:. out/pyenv/bin/python scripts/bench_voice.py [--n 20] [--assert]
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXTURE = ROOT / "scripts" / "bench_fixtures" / "answer5s.wav"

_Q = "What is a census in demography?"
_REF = "A census is a complete official count of an entire population."
_ANS = "a census is a full official count of a whole population"


def _stats(samples: list[float]) -> dict[str, float]:
    s = sorted(samples)
    p95 = s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]
    return {
        "p50": statistics.median(s) * 1000,
        "p95": p95 * 1000,
        "worst": s[-1] * 1000,
        "n": len(s),
    }


def _bench(fn, n: int) -> dict[str, float]:  # type: ignore[no-untyped-def]
    fn()  # warm
    times = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        times.append(time.perf_counter() - t)
    return _stats(times)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--assert", dest="do_assert", action="store_true")
    args = parser.parse_args()

    from ai import grade

    results: dict[str, dict[str, float]] = {}

    results["lexical_grade"] = _bench(
        lambda: grade.lexical_score(_REF, _ANS), args.n
    )

    from ai import stt

    if stt.local_available() and FIXTURE.exists():
        audio = FIXTURE.read_bytes()
        stt.transcribe(audio, mime="audio/wav")  # prewarm the model outside timing
        results["local_stt"] = _bench(
            lambda: stt.transcribe(audio, mime="audio/wav"), max(3, args.n // 4)
        )
    else:
        print(
            f"skip local_stt (local_available={stt.local_available()}, "
            f"fixture={'present' if FIXTURE.exists() else 'MISSING'})"
        )

    if grade.ai_enabled():
        results["semantic_grade"] = _bench(
            lambda: grade.grade_spoken(_Q, _REF, _ANS), max(3, args.n // 4)
        )
    else:
        print("skip semantic_grade (AI off / no ANTHROPIC_API_KEY)")

    print(f"\n{'stage':<16} {'p50(ms)':>10} {'p95(ms)':>10} {'worst(ms)':>10} {'n':>4}")
    for stage, st in results.items():
        print(
            f"{stage:<16} {st['p50']:>10.2f} {st['p95']:>10.2f} "
            f"{st['worst']:>10.2f} {int(st['n']):>4}"
        )

    if args.do_assert:
        budgets = {
            "lexical_grade": 50.0,
            "local_stt": 2500.0,
            "semantic_grade": 3000.0,
        }
        failed = []
        for stage, budget in budgets.items():
            if stage in results and results[stage]["p95"] > budget:
                failed.append(
                    f"{stage} p95 {results[stage]['p95']:.0f}ms > {budget:.0f}ms"
                )
        if failed:
            print("\nBUDGET FAILURES:\n  " + "\n  ".join(failed))
            return 1
        print("\nall measured stages within budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
