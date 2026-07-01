# Sync conflict-resolution rule (Block E · requirement D7)

> The MCAT fork keeps Anki's own conflict resolution unchanged and **documents it** here, as D7
> requires ("the conflict rule is written down"). No engine code is modified; every clause below is
> pinned by a re-runnable Rust test in `rslib/src/sync/collection/tests.rs` (module `mcat_block_e`),
> driven against the real in-process `anki-sync-server`.

## The rule, stated mechanically

**Last-Write-Wins by object modification time (LWW-by-mtime): the row with the strictly-greater
`mtime` survives.** This is "later mtime wins," **not** "more recent human edit wins" — the decision
is made on the stored timestamp, with no base-revision or 3-way merge.

It resolves into four concrete clauses:

### 1. Reviews never conflict — they are append-only and deduped by id
The revlog is append-only. Each entry's primary key is a **millisecond wall-clock `RevlogId`**
(`rslib/src/revlog/mod.rs`). The merge inserts with `INSERT OR IGNORE` and `uniquify=false`
(`merge_revlog` → `add_revlog_entry(.., false)`, `sync/collection/chunks.rs`; SQL in
`storage/revlog/add.sql`), so:
- two devices' **distinct** reviews both land exactly once (different ids → both inserted), and
- a row whose id already exists on the receiving side is **silently dropped** (never merged
  field-by-field, never double-counted).

So "10 reviews on phone + 10 different on desktop → 20 land once" needs no conflict logic at all —
the ids are distinct. *Proven by `t3_revlog_dedup_primitive`, `t4_twenty_reviews_land_once`,
`c7_offline_review_then_reconnect`.*

### 2. The same object edited on two devices → the later mtime wins
For a card / note / deck / notetype edited offline on both devices, the incoming row is applied only
if it is newer than the local one (`add_or_update_card_if_newer` / `add_or_update_note_if_newer`,
`sync/collection/chunks.rs`; `merge_notetypes` / `merge_decks` / `merge_deck_config`,
`changes.rs`). The clear, correct winner is the **strictly-greater `mtime`** — last writer wins.
*Proven by `s1_conflict_lww_by_mtime`.*

### 3. A schema-modification-time mismatch forces a full sync — so we never bump schema
If the two collections' schema timestamps (`scm`) differ, a normal sync is impossible and a one-way
**full sync** is required (`sync/collection/meta.rs`, `compared_to_remote → FullSyncRequired`). The
MCAT engine change (the read-only `MasteryQuery` RPC) is therefore **read-only and never bumps the
schema**, so it can never silently force a full sync. *(Guarded upstream of Block E by the Block B
read-only equivalence test; see docs/MORNING-REPORT.md §2.)*

### 4. Honest limitation — a wrong clock can shadow a review
Because the `RevlogId` **is** a wall-clock millisecond and the merge does not uniquify, a *true*
cross-device id collision (two different reviews stamped at the identical millisecond by skewed
clocks) resolves to **exactly one surviving row** — the other review is shadowed/dropped. We do **not**
claim both land. *Proven by `s2c_wrong_clock_revlog_id_collision`.*
**Mitigation:** rely on server-assigned time where possible; in practice millisecond collisions across
two real devices are vanishingly rare. This is recorded as a conscious, documented limitation rather
than hidden.

## Interrupted / offline safety (7g · C7)
An interrupted sync is safe: a session that is started but not finished applies nothing (the server
rolls back), and re-syncing is **idempotent** — a redundant sync after a flaky reconnect adds zero
rows. Offline reviews are queued (`usn = -1`, pending) and land on the next sync, none lost.
*Proven by `s2b_midsync_interrupt_is_clean`, `c7_offline_review_then_reconnect`; the on-device
airplane-mode demonstration is the HUMAN-recorded half of C7.*

## Clause → code → test → requirement

| Clause | Engine site (unchanged) | Test (`mcat_block_e`) | Req |
|---|---|---|---|
| Reviews dedup by ms id | `storage/revlog/add.sql`, `chunks.rs` `merge_revlog` | `t3_revlog_dedup_primitive`, `t4_twenty_reviews_land_once` | 7b, C6, I1 |
| State round-trips | `sync/collection/normal.rs` | `t2_two_collection_roundtrip` | C6, 7b |
| Same object → later mtime wins | `chunks.rs` `add_or_update_*_if_newer` | `s1_conflict_lww_by_mtime` | D7, 7b |
| Offline reviews land | `storage/sync.rs` pending (`usn=-1`) | `c7_offline_review_then_reconnect` | C7, 7b |
| Interrupt + replay clean | `sync/collection/start.rs`, `finish.rs` | `s2b_midsync_interrupt_is_clean` | 7g, C7, I1 |
| Clock-skew (honest limit) | ms `RevlogId` + `uniquify=false` | `s2c_wrong_clock_revlog_id_collision` | I1, D7 |

Decision reference: docs/05-DECISIONS.md **Decision 9** (self-hosted in-repo sync server; keep & document
Anki's conflict rule). Run contract: [SYNC.md](SYNC.md).
