#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""One-command 50k latency benchmark (challenge 7h / §10). Times REAL engine paths over N iters and
prints p50/p95/worst per action — never one hand-picked number. Runs on a THROWAWAY copy of the
fixture because answer_card mutates (writes revlog, drains the queue)."""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from anki.collection import Collection  # noqa: E402  (import first: initializes anki.cards)
from anki.cards import Card  # noqa: E402
from anki.scheduler_pb2 import CardAnswer  # noqa: E402

BUDGETS_MS = {"button_ack": 50, "next_card": 100, "dashboard_load": 1000, "dashboard_refresh": 500}
DEFAULT_FIXTURE = "/tmp/bench50k.anki2"


def _pct(samples: list[float], q: float) -> float:
    s = sorted(samples)
    if not s:
        return 0.0
    idx = min(len(s) - 1, int(round(q * (len(s) - 1))))
    return s[idx]


def _summ(name: str, ms: list[float]) -> dict:
    p95 = round(_pct(ms, 0.95), 3)
    budget = BUDGETS_MS[name]
    return {
        "p50": round(_pct(ms, 0.50), 3),
        "p95": p95,
        "worst": round(max(ms) if ms else 0.0, 3),
        "n": len(ms),
        "budget_ms": budget,
        "pass": p95 < budget,
    }


def run(collection: str, iters: int = 200) -> dict[str, dict]:
    work = str(Path(collection).with_suffix(".bench-copy.anki2"))
    shutil.copy(collection, work)
    col = Collection(work)
    try:
        assert not hasattr(Collection, "answer_card"), "answer_card lives on col.sched, not Collection"
        button, nextc, load, refresh = [], [], [], []
        # dashboard cold load then warm refreshes
        t = time.perf_counter()
        col.mastery_query("", 0.0)
        load.append((time.perf_counter() - t) * 1000)
        for _ in range(iters):
            t = time.perf_counter()
            col.mastery_query("", 0.0)
            refresh.append((time.perf_counter() - t) * 1000)
        col.decks.select(col.decks.id("MCAT"))
        col.reset()
        for _ in range(iters):
            t = time.perf_counter()
            qc = col.sched.get_queued_cards(fetch_limit=1)
            nextc.append((time.perf_counter() - t) * 1000)
            if not qc.cards:
                col.reset()
                qc = col.sched.get_queued_cards(fetch_limit=1)
                if not qc.cards:
                    break
            c = Card(col)
            c._load_from_backend_card(qc.cards[0].card)
            c.start_timer()
            inp = col.sched.build_answer(card=c, states=qc.cards[0].states, rating=CardAnswer.GOOD)
            t = time.perf_counter()
            col.sched.answer_card(inp)
            button.append((time.perf_counter() - t) * 1000)
        return {
            "button_ack": _summ("button_ack", button),
            "next_card": _summ("next_card", nextc),
            "dashboard_load": _summ("dashboard_load", load),
            "dashboard_refresh": _summ("dashboard_refresh", refresh),
        }
    finally:
        col.close()
        Path(work).unlink(missing_ok=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", default=DEFAULT_FIXTURE)
    ap.add_argument("--iters", type=int, default=200)
    a = ap.parse_args(argv)
    if not Path(a.collection).exists():
        sys.stderr.write(f"[bench] fixture {a.collection} missing — run scripts/gen_bench_deck.py first\n")
        return 2
    rows = run(a.collection, iters=a.iters)
    ok = True
    print(f"{'action':<20}{'p50(ms)':>10}{'p95(ms)':>10}{'worst(ms)':>12}{'budget':>10}{'result':>8}")
    for name, r in rows.items():
        ok = ok and r["pass"]
        print(
            f"{name:<20}{r['p50']:>10}{r['p95']:>10}{r['worst']:>12}{r['budget_ms']:>10}"
            f"{'PASS' if r['pass'] else 'FAIL':>8}"
        )
    print(f"N per action = {a.iters}; source = {a.collection}; device = local dev machine (arm64 macOS)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
