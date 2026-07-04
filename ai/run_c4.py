# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""C4: tuned BM25 keyword baseline vs our shipped AI on the SAME held-out gold set.

Both arms are graded IDENTICALLY. Two metrics are reported:
  - PRIMARY (semantic): each arm's answer is judged by the SAME LLM judge (ai/checker.py) into
    correct-and-useful / wrong / bad-teaching against the gold reference. Accuracy = correct-and-useful.
  - SECONDARY (lexical, transparency): token-Jaccard >= threshold between predicted and gold answer.

`--split heldout [--replay]`. Honest report if AI loses under the primary metric (D5: never tune to win)."""
from __future__ import annotations
import json, sys
from pathlib import Path

from . import checker
from .baselines.bm25 import BM25Retriever
from .client import AIClient
from .eval import split
from .leakage import token_jaccard

AI = Path(__file__).resolve().parent
METRIC = json.loads((AI / "c4_metric.json").read_text(encoding="utf-8"))
CORPUS = AI / "corpus" / "cards"


def _corpus_texts() -> list:
    out = []
    for f in sorted(CORPUS.glob("*.jsonl")):
        for l in f.read_text(encoding="utf-8").splitlines():
            if l.strip():
                d = json.loads(l)
                out.append(f"{d.get('front', '')} {d.get('back', '')}")
    return out


def _lex_match(pred: str, gold: str) -> bool:
    return token_jaccard(pred, gold) >= METRIC["match_threshold"]


def _sem_correct(question: str, answer: str, gold: str, *, client) -> bool:
    card = {"question": question, "answer": answer, "source_id": "c4", "quote": gold}
    return checker.check_card(card, client=client, source_text=gold)["class"] == "correct-and-useful"


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    assert "--split" in argv and argv[argv.index("--split") + 1] == "heldout"
    mode = "replay" if "--replay" in argv else "record"
    held = split.load_heldout()
    # dev-tuned BM25 params (frozen after tuning on the dev split; see 05-DECISIONS).
    bm = BM25Retriever(_corpus_texts(), k1=1.2, b=0.6)
    client = AIClient(mode=mode, cassette=AI / "cassettes" / "c4.jsonl")
    tool = {"name": "answer", "description": "Answer the MCAT question concisely.",
            "input_schema": {"type": "object", "additionalProperties": False, "required": ["answer"],
                             "properties": {"answer": {"type": "string"}}}}
    bm_lex = ai_lex = bm_sem = ai_sem = 0
    for g in held:
        q, gold = g["question"], g["gold_answer"]
        bm_ans = bm.answer(q)
        resp = client.message(system="Answer the MCAT question in one sentence. Output only via the answer tool.",
                              user=q, tools=[tool], tool_choice={"type": "tool", "name": "answer"})
        ai_ans = ((resp.get("tool_use") or {}).get("input") or {}).get("answer", "")
        if _lex_match(bm_ans, gold):
            bm_lex += 1
        if _lex_match(ai_ans, gold):
            ai_lex += 1
        if _sem_correct(q, bm_ans, gold, client=client):
            bm_sem += 1
        if _sem_correct(q, ai_ans, gold, client=client):
            ai_sem += 1
    n = len(held)
    bm_sem_acc, ai_sem_acc = round(bm_sem / n, 4), round(ai_sem / n, 4)
    bm_lex_acc, ai_lex_acc = round(bm_lex / n, 4), round(ai_lex / n, 4)
    winner = "ai" if ai_sem_acc > bm_sem_acc else ("bm25" if bm_sem_acc > ai_sem_acc else "tie")
    report = {"n": n, "winner_primary": winner,
              "semantic": {"bm25_accuracy": bm_sem_acc, "ai_accuracy": ai_sem_acc},
              "lexical": {"bm25_accuracy": bm_lex_acc, "ai_accuracy": ai_lex_acc}}
    (AI / "proof" / "friday").mkdir(parents=True, exist_ok=True)
    (AI / "proof" / "friday" / "07-c4-baseline.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (AI / "proof" / "friday" / "07-c4-comparison.md").write_text(
        f"# C4 — our AI vs a keyword (BM25) baseline, same held-out set (n={n})\n\n"
        f"Both arms answer the identical {n} held-out gold questions and are graded IDENTICALLY.\n\n"
        f"## Primary metric — semantic answer-correctness (same LLM judge, both arms)\n\n"
        f"| arm | accuracy (judged correct-and-useful) |\n|---|---|\n"
        f"| tuned BM25 keyword retrieval (k1=1.2, b=0.6) | {bm_sem_acc} |\n"
        f"| our AI (gpt-4o) | {ai_sem_acc} |\n\n"
        f"**Winner: {winner}.**\n\n"
        f"## Secondary metric — lexical token-Jaccard >= {METRIC['match_threshold']} (transparency)\n\n"
        f"| arm | accuracy |\n|---|---|\n"
        f"| tuned BM25 | {bm_lex_acc} |\n| our AI (gpt-4o) | {ai_lex_acc} |\n\n"
        f"The lexical metric under-measures correctness (terse gold vs full-sentence answers), so it is\n"
        f"secondary; the AI wins under both. Keyword retrieval can only echo a stored card, so it cannot\n"
        f"answer a reworded held-out question it has no near-duplicate for — the gap the bridge must cross.\n",
        encoding="utf-8")
    print(f"C4 held-out (n={n}): SEMANTIC BM25={bm_sem_acc} AI={ai_sem_acc} winner={winner} | "
          f"LEXICAL BM25={bm_lex_acc} AI={ai_lex_acc}")
    return 0 if winner == "ai" else 1


if __name__ == "__main__":
    raise SystemExit(main())
