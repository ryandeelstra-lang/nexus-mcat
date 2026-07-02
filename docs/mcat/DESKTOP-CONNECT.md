# Connecting the desktop to the same self-hosted sync server (Phase 5)

> An "account" in this fork is an Anki sync account on the **self-hosted `anki-sync-server`**.
> "Connect accounts across desktop and mobile" = both clients log in with the **same
> credentials** against the **same server URL**, so they share one collection and reviews
> flow both ways. Nothing here is a bespoke auth system — it is stock Anki self-hosted sync.

## 1. Start the server (once)

```bash
# from the fork root, after `just check` has built it (or: cargo build -p anki-sync-server)
SYNC_USER1=demo:demo \
SYNC_HOST=0.0.0.0 \
SYNC_PORT=8080 \
SYNC_BASE=/tmp/charged_sync \
  out/rust/debug/anki-sync-server
```

- `SYNC_USER1=demo:demo` creates one account `demo` with password `demo`.
- `SYNC_HOST=0.0.0.0` lets a phone on the same Wi‑Fi reach it (use `127.0.0.1` for simulator only).
- Note the machine's LAN IP (e.g. `192.168.1.50`) — the phone uses `http://192.168.1.50:8080/`.
- Transport is **plain HTTP** on the LAN (see [SYNC.md](SYNC.md)); fine for localhost/LAN. The
  iOS client also supports real-internet HTTPS via rustls.

## 2. Point the desktop at it (do NOT hard-code — use Preferences)

The desktop already supports self-hosted sync (stock Anki); no code change is needed.

1. Open the desktop app → **Preferences** (⌘,) → **Syncing**.
2. In **Self-hosted sync server**, enter the SAME URL the phone uses, e.g. `http://127.0.0.1:8080/`
   (simulator on the same Mac) or `http://192.168.1.50:8080/` (phone on Wi‑Fi).
   - Under the hood this calls `pm.set_custom_sync_url(...)` → `profile["customSyncUrl"]`
     (`qt/aqt/preferences.py:311`, `qt/aqt/profiles.py:725`); the sync then targets that URL
     (`profiles.py:706`).
3. Click **Sync** (or press `Y`) and log in with **`demo` / `demo`**.
4. First sync: choose **Upload to server** (desktop → server) so the server holds your MCAT
   collection. The phone then **Downloads** it on first sign-in (it picks the direction
   automatically).

## 3. Prove it end to end (the §7b flow, by hand)

1. Desktop: review a few cards, **Sync**.
2. Phone (charged_up app): sign in with `demo`/`demo` and the same URL → it downloads the deck.
3. Phone: review some cards **offline** (turn on Airplane Mode), then turn Wi‑Fi back on and tap
   the sync button.
4. Desktop: **Sync** again → the phone's reviews appear.
5. Conflict: review the SAME card on both while offline, then sync both — the later edit wins
   (last-write-wins by mtime; see [CONFLICT-RULE.md](CONFLICT-RULE.md)).

The automated, re-runnable version of step 3–5 is the host-side test `tests/sync/` — run it with
`scripts/run_sync_test.sh` (it drives the iOS C ABI against this same server).

## Notes

- Same URL + same account on both clients is the ONLY requirement to "connect accounts."
- The engine is shared: the desktop (pylib → rsbridge → Rust) and the phone (SwiftUI → C ABI →
  Rust) run the **same** `run_service_method` entrypoint, the same scheduler, the same sync.
- No schema bump, no proto change: normal review + normal sync only (Decision 19).
