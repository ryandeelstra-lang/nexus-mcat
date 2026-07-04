#!/usr/bin/env python3
# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
"""Desktop side of the live phone<->desktop sync proof. Uses the SAME shared engine (pylib) as the
desktop app, against the self-hosted anki-sync-server the phone also syncs to.

Commands:
  pull  <col.anki2>            login + sync; if a full sync is required, full-download. Print counts.
  review <col.anki2> <n>       review N due/new cards (real graded reviews), then normal-sync up.
  count <col.anki2>            print revlog + note counts (read-only).

Exit 0 = ok. Env: SYNC_ENDPOINT (default http://127.0.0.1:8998/), SYNC_USER/SYNC_PASS (demo/demo)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pylib"))
from anki.collection import Collection  # noqa: E402
from anki.scheduler.v3 import CardAnswer  # noqa: E402
import anki.sync_pb2 as sync_pb2  # noqa: E402

ENDPOINT = os.environ.get("SYNC_ENDPOINT", "http://127.0.0.1:8998/")
USER = os.environ.get("SYNC_USER", "demo")
PASS = os.environ.get("SYNC_PASS", "demo")

FULL = {
    sync_pb2.SyncCollectionResponse.ChangesRequired.FULL_SYNC,
    sync_pb2.SyncCollectionResponse.ChangesRequired.FULL_DOWNLOAD,
    sync_pb2.SyncCollectionResponse.ChangesRequired.FULL_UPLOAD,
}


def counts(col):
    return (
        col.db.scalar("select count() from revlog"),
        col.db.scalar("select count() from cards"),
        col.db.scalar("select count() from notes"),
    )


def sync_once(col, *, prefer_upload):
    auth = col.sync_login(USER, PASS, ENDPOINT)
    out = col.sync_collection(auth, False)
    if out.required in FULL:
        upload = prefer_upload or (
            out.required == sync_pb2.SyncCollectionResponse.ChangesRequired.FULL_UPLOAD
        )
        col.full_upload_or_download(auth=auth, server_usn=None, upload=upload)
        return "full-upload" if upload else "full-download"
    return "normal"


def open_col(path):
    return Collection(path)


def cmd_pull(path):
    col = open_col(path)
    action = sync_once(col, prefer_upload=False)
    # a full download closes + swaps the file; reopen to read the truth
    if action == "full-download":
        col.close()
        col = open_col(path)
    r, c, n = counts(col)
    print(f"DESKTOP pull: action={action} revlog={r} cards={c} notes={n}")
    col.close()
    return 0


def cmd_review(path, n):
    from anki.cards import Card

    col = open_col(path)
    sched = col.sched
    reviewed = 0
    for _ in range(n):
        queued = sched.get_queued_cards(fetch_limit=1)
        if not queued.cards:
            break
        qc = queued.cards[0]
        card = Card(col, backend_card=qc.card)
        answer = sched.build_answer(card=card, states=qc.states, rating=CardAnswer.GOOD)
        sched.answer_card(answer)
        reviewed += 1
    action = sync_once(col, prefer_upload=False)
    r, c, n2 = counts(col)
    print(f"DESKTOP review: reviewed={reviewed} sync={action} revlog={r} cards={c} notes={n2}")
    col.close()
    return 0


def cmd_count(path):
    col = open_col(path)
    r, c, n = counts(col)
    print(f"DESKTOP count: revlog={r} cards={c} notes={n}")
    col.close()
    return 0


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    cmd, path = sys.argv[1], sys.argv[2]
    if cmd == "pull":
        return cmd_pull(path)
    if cmd == "review":
        return cmd_review(path, int(sys.argv[3]))
    if cmd == "count":
        return cmd_count(path)
    print(f"unknown command {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
