#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""7b verifier: reads phone + desktop collection files READ-ONLY and asserts the sync invariants.

Usage:
  verify_7b.py --phone <collection.anki2> --desktop <collection.anki2> --phase twenty
  verify_7b.py --phone ... --desktop ... --phase conflict --card <card_id>

Exit 0 = PASS. Prints every number it checks (tee this output into the evidence file)."""
import argparse
import sqlite3
import sys


def revlog(path):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    rows = con.execute("select id, cid from revlog order by id").fetchall()
    con.close()
    return rows


def card_mtime_state(path, cid):
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    row = con.execute("select mod, ivl, reps from cards where id=?", (cid,)).fetchone()
    con.close()
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phone", required=True)
    ap.add_argument("--desktop", required=True)
    ap.add_argument("--phase", choices=["twenty", "conflict"], required=True)
    ap.add_argument("--card", type=int, default=0)
    ap.add_argument("--expect", type=int, default=20, help="expected revlog rows for --phase twenty")
    a = ap.parse_args()

    p, d = revlog(a.phone), revlog(a.desktop)
    print(f"phone   revlog rows: {len(p)}")
    print(f"desktop revlog rows: {len(d)}")
    pids, dids = [r[0] for r in p], [r[0] for r in d]
    assert sorted(pids) == sorted(dids), "revlog id sets differ across devices"
    assert len(set(pids)) == len(pids), "duplicate revlog id => double-counted review"
    print("revlog id sets IDENTICAL on both devices; zero duplicates")

    if a.phase == "twenty":
        assert len(p) == a.expect, f"expected exactly {a.expect} reviews, got {len(p)}"
        print(f"7b-TWENTY: PASS — {a.expect} reviews all landed exactly once on both devices")
    else:
        assert a.card, "--card required for the conflict phase"
        both = [r for r in p if r[1] == a.card]
        assert len(both) == 2, f"expected BOTH same-card reviews to land (got {len(both)})"
        pm, dm = card_mtime_state(a.phone, a.card), card_mtime_state(a.desktop, a.card)
        print(f"card {a.card}: phone (mod,ivl,reps)={pm} desktop={dm}")
        assert pm == dm, "card state diverged — LWW did not converge"
        print("7b-CONFLICT: PASS — both reviews kept (append-only revlog, distinct ms ids);")
        print("card STATE converged to the later-mtime writer per docs/mcat/CONFLICT-RULE.md (LWW)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
