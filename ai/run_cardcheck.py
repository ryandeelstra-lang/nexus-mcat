# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Documented command: check the 50 generated cards, print the three counts + the PRE-REGISTERED cutoff,
block failures, exit non-zero if below cutoff. Reproducible via ai/cassettes/checker.jsonl (--replay)."""
from __future__ import annotations
import json, sys
from pathlib import Path

from . import checker, corpus_text
from .client import AIClient

AI = Path(__file__).resolve().parent
CUTOFF = json.loads((AI / "cutoff.json").read_text(encoding="utf-8"))
SOURCE_ID = "openstax-biology-2e.ch03"


def passes_cutoff(counts: dict) -> bool:
    return counts["correct-and-useful"] >= CUTOFF["min_correct_and_useful"] and counts["wrong"] <= CUTOFF["max_wrong"]


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    mode = "replay" if "--replay" in argv else "record"
    cards = [json.loads(l) for l in (AI / "artifacts" / "cards.jsonl").read_text().splitlines() if l.strip()]
    client = AIClient(mode=mode, cassette=AI / "cassettes" / "checker.jsonl")
    src = corpus_text.load_source_text(SOURCE_ID)
    res = checker.run_checker(cards, client=client, source_text=src)
    ok = passes_cutoff(res["counts"])
    report = {"counts": res["counts"], "cutoff": CUTOFF, "pass": ok, "shippable": len(res["accepted"]),
              "blocked": len(res["blocked"])}
    (AI / "proof" / "friday").mkdir(parents=True, exist_ok=True)
    (AI / "proof" / "friday" / "05-cardcheck.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"correct-and-useful={res['counts']['correct-and-useful']} / wrong={res['counts']['wrong']} / "
          f"correct-but-bad-teaching={res['counts']['correct-but-bad-teaching']}  "
          f"cutoff(>= {CUTOFF['min_correct_and_useful']} & <= {CUTOFF['max_wrong']} wrong) -> {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
