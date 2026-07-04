# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""C3: the held-out eval that runs BEFORE any student sees a card. The AI answerer answers each HELD-OUT
gold question (never the tune/dev slice), then each AI answer is classified against the gold reference by
the checker into correct-and-useful / wrong / correct-but-bad-teaching. Reports accuracy + wrong-answer
rate + bad-teaching vs the pre-registered cutoff rates. `--split heldout [--replay]`; reproducible via
ai/cassettes/eval.jsonl. An honest FAIL is a valid, reportable result — never tune the split to force PASS."""
from __future__ import annotations
import json, sys
from pathlib import Path

from . import checker
from .client import AIClient
from .eval import metrics, split

AI = Path(__file__).resolve().parent
CUTOFF = json.loads((AI / "cutoff.json").read_text(encoding="utf-8"))

_ANSWER_TOOL = {"name": "answer", "description": "Answer the MCAT question concisely.",
                "input_schema": {"type": "object", "additionalProperties": False, "required": ["answer"],
                                 "properties": {"answer": {"type": "string"}}}}


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    assert "--split" in argv and argv[argv.index("--split") + 1] == "heldout", "C3 reads only the held-out split"
    split.assert_disjoint()
    mode = "replay" if "--replay" in argv else "record"
    items = split.load_heldout()
    client = AIClient(mode=mode, cassette=AI / "cassettes" / "eval.jsonl")

    counts = {c: 0 for c in checker.CLASSES}
    per_item = []
    for g in items:
        resp = client.message(system="Answer the MCAT question in one sentence. Output only via the answer tool.",
                              user=g["question"], tools=[_ANSWER_TOOL], tool_choice={"type": "tool", "name": "answer"})
        ai_ans = ((resp.get("tool_use") or {}).get("input") or {}).get("answer", "")
        card = {"question": g["question"], "answer": ai_ans, "source_id": g["provenance_source"], "quote": g["gold_answer"]}
        verdict = checker.check_card(card, client=client, source_text=g["gold_answer"])
        counts[verdict["class"]] += 1
        per_item.append({"id": g["id"], "ai_answer": ai_ans, "gold": g["gold_answer"], "class": verdict["class"]})

    m = metrics.summarize(counts, n=len(items))
    ok = m["accuracy"] >= CUTOFF["min_correct_and_useful"] / CUTOFF["n"] and \
        m["wrong_answer_rate"] <= CUTOFF["max_wrong"] / CUTOFF["n"]
    report = {"split": "heldout", "counts": counts, **m, "cutoff": CUTOFF, "pass": ok, "items": per_item}
    (AI / "proof" / "friday").mkdir(parents=True, exist_ok=True)
    (AI / "proof" / "friday" / "06-eval-heldout.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"held-out (n={m['n']}): accuracy={m['accuracy']} wrong_answer_rate={m['wrong_answer_rate']} "
          f"bad_teaching={m['bad_teaching']} -> {'PASS' if ok else 'FAIL'} "
          f"(cutoff: acc>={CUTOFF['min_correct_and_useful']/CUTOFF['n']:.2f}, wrong<={CUTOFF['max_wrong']/CUTOFF['n']:.2f})")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
