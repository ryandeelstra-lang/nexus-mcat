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

## T2–T4 / S1–S2 — engine-level proofs (DONE, all green)

All Block E sync invariants are pinned by re-runnable Rust tests in
`rslib/src/sync/collection/tests.rs` (module `mcat_block_e`), driven against the real in-process
`anki-sync-server`. Verified: `cargo test -p anki mcat_block_e` → **7 passed**; full
`cargo test -p anki --lib` → **533 passed, 0 failed** (no regression). The conflict rule (S1/D7) is
documented in [CONFLICT-RULE.md](CONFLICT-RULE.md).

- **T2** `t2_two_collection_roundtrip` — note added on col1 → full round-trip → note count matches on both.
- **T3** `t3_revlog_dedup_primitive` — `INSERT OR IGNORE` on the ms `RevlogId`: same id lands once, distinct
  ids land twice, same-card distinct-ids both land (hardening L4: the SQLite primitive, not the merge invariant).
- **T4** `t4_twenty_reviews_land_once` — the 7b headline: 10 reviews on A + 10 different on B, offline →
  reconnect/sync → **all 20 land once** (none lost, none doubled); both collections converge to the same set.
- **S1** `s1_conflict_lww_by_mtime` — same note edited offline on both → the **later mtime wins** on both
  sides (LWW); the rule is written down in CONFLICT-RULE.md (satisfies D7).
- **C7** `c7_offline_review_then_reconnect` — offline reviews land on the other device after reconnect.
- **S2b** `s2b_midsync_interrupt_is_clean` — an interrupted (start→abort) sync + a redundant replay →
  no loss, no double-count (idempotent).
- **S2c** `s2c_wrong_clock_revlog_id_collision` — honest clock-skew limitation: a true cross-device id
  collision resolves to **exactly one** surviving row (we do not claim both reviews land).

### Still HUMAN-gated (untested ≠ passed)

- The on-device **airplane-mode recording** for C7 (the engine-level proof above is automated; the phone demo is human).
- The **iOS client** half of two-way sync (Step **F1**, contingent on the W1 rustls spike) — outside Block E;
  it consumes this server.
- The **50k-deck sync timing** gate (H5 < 5 s) — Block H (`make bench`), not yet run.
