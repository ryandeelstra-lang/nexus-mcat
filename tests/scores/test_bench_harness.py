# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

# charged_up W3.2: the one-command 50k latency benchmark (p50/p95/worst per §H action, 7h/§10).
#   PYTHONPATH=out/pylib:. ANKI_TEST_MODE=1 out/pyenv/bin/python -m pytest tests/scores/test_bench_harness.py

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))
import bench  # noqa: E402
import gen_bench_deck  # noqa: E402


def test_budgets_match_section_10():
    # §10 targets, in ms, keyed by action — pinned so a silent budget edit fails the suite.
    assert bench.BUDGETS_MS["button_ack"] == 50
    assert bench.BUDGETS_MS["next_card"] == 100
    assert bench.BUDGETS_MS["dashboard_load"] == 1000
    assert bench.BUDGETS_MS["dashboard_refresh"] == 500


def test_run_reports_all_actions_with_distributions(tmp_path):
    out = tmp_path / "b.anki2"
    gen_bench_deck.build(str(out), n_cards=400, n_answer=120, seed=3)
    rows = bench.run(str(out), iters=25)
    for action in ("button_ack", "next_card", "dashboard_load", "dashboard_refresh"):
        r = rows[action]
        for k in ("p50", "p95", "worst", "n", "budget_ms", "pass"):
            assert k in r
        assert r["worst"] >= r["p95"] >= r["p50"] >= 0  # never one hand-picked number (7h)
        assert r["n"] >= 1
