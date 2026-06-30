# Sync — self-hosted transport for desktop ↔ iOS (Block E)

charged_up reuses Anki's own in-repo sync server (`rslib/sync`, binary `anki-sync-server`,
`SimpleServer::run()`), so desktop and the iOS app sync through **one engine + one protocol** — the
"syncs" half of the 70% "iOS shares the engine AND syncs" gate (the "shares the engine" half is proven
by the W1 iOS cross-compile GO).

## T1 — the server builds + run contract (DONE)

- Build: `cargo build -p anki-sync-server` → `out/rust/debug/anki-sync-server` (verified, 16.46s).
- Run (env from `rslib/src/sync/http_server/mod.rs`): a single user, a base dir for collections, host/port:
  ```bash
  SYNC_USER1=demo:demo SYNC_HOST=127.0.0.1 SYNC_PORT=8080 SYNC_BASE=/tmp/charged_sync \
    out/rust/debug/anki-sync-server
  ```
- Point the desktop fork at it: set `customSyncUrl = http://127.0.0.1:8080/` (profile pref,
  `qt/aqt/profiles.py`), then Sync. The same URL is what the iOS client targets.
- TLS: the server binds **plain HTTP** on the LAN (`http_server/mod.rs` `TcpListener`, no TLS acceptor);
  the iOS client uses **rustls** for real-internet HTTPS (proven to cross-compile in W1; a live device
  TLS/trust-store handshake is HUMAN-recorded).

## Still to build (T2–T4 / S1–S2)

- **T2** scripted round-trip: review on collection A → sync → review on B → sync → both revlogs merged.
- **T3** revlog dedup detector (`INSERT OR IGNORE` on the ms `RevlogId`).
- **T4** the 7b test: 10 cards on phone + 10 different on desktop offline → reconnect → **all 20 land once**
  (none lost, none doubled).
- **S1** conflict rule: same card reviewed on both offline → **last-write-wins by mtime**, documented here.
- **S2** offline-reconnect / mid-sync-interrupt / wrong-clock engine tests (airplane-mode _recording_ is HUMAN).
