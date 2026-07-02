// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! §7b host-side sync integration test (charged_up MCAT fork).
//!
//! This drives the SAME 4-symbol iOS C ABI the ChargedUp SwiftUI app uses (`anki-ios`)
//! against the SAME self-hosted `anki-sync-server` (`anki::sync::http_server`), started
//! in-process with `SYNC_USER1=demo:demo` (identical code + auth contract to the binary
//! in docs/mcat/SYNC.md). It is deliberately separate from the engine-internal
//! `mcat_block_e` unit tests — it exercises the FFI + server boundary end to end.
//!
//! It proves the instructions §7b claim:
//!   (b) two independent collections log in with the same credentials/URL (via `SyncLogin`
//!       over the FFI) and share one server-side collection;
//!   (c) 10 cards reviewed offline on A + 10 DIFFERENT offline on B → sync → all 20 land
//!       exactly once (none lost, none double-counted);
//!   (d) the SAME card edited offline on both → sync → the last-write-wins-by-mtime winner
//!       survives on both sides (docs/mcat/CONFLICT-RULE.md clause 2).
//!
//! Every (service, method) u32 is derived from Anki's DescriptorPool at runtime — the same
//! positional scheme `run_service_method` dispatches on — so the test can never silently
//! use a wrong index (and it cross-checks the Swift-side ServiceIndices.swift generator).

use std::collections::BTreeSet;
use std::collections::HashMap;
use std::collections::HashSet;
use std::net::SocketAddr;
use std::net::TcpListener;
use std::net::TcpStream;
use std::path::Path;
use std::path::PathBuf;
use std::process::Child;
use std::process::Command;
use std::process::Stdio;
use std::time::Duration;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use anki_proto::backend::BackendInit;
use anki_proto::cards::Card;
use anki_proto::cards::CardId;
use anki_proto::collection::CloseCollectionRequest;
use anki_proto::collection::OpenCollectionRequest;
use anki_proto::generic::Empty;
use anki_proto::notes::AddNoteRequest;
use anki_proto::notes::AddNoteResponse;
use anki_proto::notes::Note;
use anki_proto::notetypes::NotetypeNames;
use anki_proto::scheduler::card_answer::Rating;
use anki_proto::scheduler::CardAnswer;
use anki_proto::scheduler::SchedulingStates;
use anki_proto::search::SearchRequest;
use anki_proto::search::SearchResponse;
use anki_proto::sync::sync_collection_response::ChangesRequired;
use anki_proto::sync::FullUploadOrDownloadRequest;
use anki_proto::sync::SyncAuth;
use anki_proto::sync::SyncCollectionRequest;
use anki_proto::sync::SyncCollectionResponse;
use anki_proto::sync::SyncLoginRequest;
use anyhow::bail;
use anyhow::Context;
use anyhow::Result;
use prost::Message;
use prost_reflect::DescriptorPool;
use rusqlite::Connection;

// ---- (service, method) indices, derived from the DescriptorPool ---------------------
// Mirrors rslib/proto_gen/src/lib.rs::get_services + rslib/rust_interface.rs exactly.

struct Indices {
    // backend service name -> (service index, method name -> method index)
    by_service: HashMap<String, (u32, HashMap<String, u32>)>,
}

impl Indices {
    fn load() -> Result<Self> {
        let path = descriptors_path()?;
        let bytes = std::fs::read(&path)
            .with_context(|| format!("reading descriptor set {}", path.display()))?;
        let pool = DescriptorPool::decode(bytes.as_ref())?;
        let services: Vec<_> = pool.services().collect();

        let mut by_service = HashMap::new();
        for svc in &services {
            let name = svc.name();
            if !name.starts_with("Backend") || name == "BackendFrontendService" {
                continue;
            }
            let mut methods = HashMap::new();
            let mut trait_names = HashSet::new();
            let mut trait_len = 0u32;
            for m in svc.methods() {
                trait_len += 1;
                trait_names.insert(m.name().to_string());
                methods.insert(m.name().to_string(), m.index() as u32);
            }
            // collection-service methods absent from the backend are delegated, offset by
            // the backend trait-method count (get_services' delegating_methods rule).
            let col_name = name.trim_start_matches("Backend");
            if let Some(col) = services.iter().find(|s| s.name() == col_name) {
                for m in col.methods() {
                    if !trait_names.contains(m.name()) {
                        methods.insert(m.name().to_string(), m.index() as u32 + trait_len);
                    }
                }
            }
            by_service.insert(name.to_string(), (svc.index() as u32, methods));
        }
        Ok(Self { by_service })
    }

    fn get(&self, service: &str, method: &str) -> (u32, u32) {
        let (svc, methods) = self
            .by_service
            .get(service)
            .unwrap_or_else(|| panic!("unknown backend service {service}"));
        let m = methods
            .get(method)
            .unwrap_or_else(|| panic!("unknown method {service}.{method}"));
        (*svc, *m)
    }
}

fn descriptors_path() -> Result<PathBuf> {
    if let Ok(p) = std::env::var("DESCRIPTORS_BIN") {
        let p = PathBuf::from(p);
        if p.exists() {
            return Ok(p);
        }
    }
    // fall back to the canonical build location relative to this crate
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../out/rslib/proto/descriptors.bin")
        .canonicalize();
    match p {
        Ok(p) => Ok(p),
        Err(_) => bail!("descriptors.bin not found — run `just check` (or `just build`) first"),
    }
}

// ---- the iOS C ABI, called exactly as AnkiBridge.swift does --------------------------

struct Engine {
    backend: *mut anki::backend::Backend,
}

impl Engine {
    fn open() -> Result<Self> {
        let init = BackendInit {
            preferred_langs: vec![],
            locale_folder_path: String::new(),
            server: false,
        };
        let bytes = init.encode_to_vec();
        // SAFETY: pointer+len describe `bytes`; the FFI copies before returning.
        let backend = unsafe { anki_ios::anki_open_backend(bytes.as_ptr(), bytes.len()) };
        if backend.is_null() {
            bail!("anki_open_backend returned null");
        }
        Ok(Self { backend })
    }

    /// Run one (service, method); copy the bytes out then free exactly like Swift.
    fn run(&self, service: u32, method: u32, input: &[u8]) -> Result<Vec<u8>> {
        let mut is_err: u8 = 0;
        // SAFETY: `backend` came from anki_open_backend; input slice is valid.
        let buf = unsafe {
            anki_ios::anki_run_method(
                self.backend,
                service,
                method,
                input.as_ptr(),
                input.len(),
                &mut is_err,
            )
        };
        let out = if buf.ptr.is_null() {
            Vec::new()
        } else {
            // SAFETY: buf.ptr/len describe a valid Rust-owned buffer until we free it.
            unsafe { std::slice::from_raw_parts(buf.ptr, buf.len) }.to_vec()
        };
        // SAFETY: buf came from anki_run_method; freed exactly once, with its own cap.
        unsafe { anki_ios::anki_buffer_free(buf) };
        match is_err {
            0 => Ok(out),
            1 => {
                let msg = anki_proto::backend::BackendError::decode(out.as_slice())
                    .map(|e| e.message)
                    .unwrap_or_else(|_| "<undecodable backend error>".into());
                bail!("backend error (is_err=1): {msg}");
            }
            _ => bail!("panic caught in anki_run_method (is_err=2)"),
        }
    }

    fn call<Req: Message, Resp: Message + Default>(
        &self,
        service: u32,
        method: u32,
        req: &Req,
    ) -> Result<Resp> {
        let out = self.run(service, method, &req.encode_to_vec())?;
        Ok(Resp::decode(out.as_slice())?)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: backend came from anki_open_backend and is closed exactly once.
        unsafe { anki_ios::anki_close_backend(self.backend) };
    }
}

// ---- a "device": one backend + one on-disk collection, driven over the FFI ----------

struct Device<'a> {
    eng: Engine,
    idx: &'a Indices,
    auth: Option<SyncAuth>,
}

impl<'a> Device<'a> {
    fn open(dir: &Path, name: &str, idx: &'a Indices) -> Result<Self> {
        let eng = Engine::open()?;
        let col_path = dir.join(format!("{name}.anki2"));
        let media = dir.join(format!("{name}.media"));
        std::fs::create_dir_all(&media)?;
        let (s, m) = idx.get("BackendCollectionService", "OpenCollection");
        eng.run(
            s,
            m,
            &OpenCollectionRequest {
                collection_path: col_path.to_string_lossy().into_owned(),
                media_folder_path: media.to_string_lossy().into_owned(),
                media_db_path: dir.join(format!("{name}.media.db")).to_string_lossy().into_owned(),
            }
            .encode_to_vec(),
        )?;
        Ok(Self { eng, idx, auth: None })
    }

    /// SyncLogin over the FFI — the exact iOS sign-in path. Stores the returned hkey/auth.
    fn login(&mut self, endpoint: &str) -> Result<()> {
        let (s, m) = self.idx.get("BackendSyncService", "SyncLogin");
        let auth: SyncAuth = self.eng.call(
            s,
            m,
            &SyncLoginRequest {
                username: "demo".into(),
                password: "demo".into(),
                endpoint: Some(endpoint.to_string()),
            },
        )?;
        if auth.hkey.is_empty() {
            bail!("SyncLogin returned an empty hkey");
        }
        self.auth = Some(auth);
        Ok(())
    }

    fn auth(&self) -> SyncAuth {
        self.auth.clone().expect("must login first")
    }

    fn basic_notetype_id(&self) -> Result<i64> {
        let (s, m) = self.idx.get("BackendNotetypesService", "GetNotetypeNames");
        let names: NotetypeNames = self.eng.call(s, m, &Empty {})?;
        names
            .entries
            .into_iter()
            .find(|e| e.name == "Basic")
            .map(|e| e.id)
            .context("collection has no 'Basic' notetype")
    }

    fn add_note(&self, notetype_id: i64, front: &str) -> Result<i64> {
        let (s, m) = self.idx.get("BackendNotesService", "AddNote");
        let resp: AddNoteResponse = self.eng.call(
            s,
            m,
            &AddNoteRequest {
                note: Some(Note {
                    id: 0,
                    guid: String::new(),
                    notetype_id,
                    mtime_secs: 0,
                    usn: 0,
                    tags: vec![],
                    fields: vec![front.to_string(), String::new()],
                }),
                deck_id: 1, // Default deck
            },
        )?;
        Ok(resp.note_id)
    }

    fn all_card_ids(&self) -> Result<Vec<i64>> {
        let (s, m) = self.idx.get("BackendSearchService", "SearchCards");
        let resp: SearchResponse = self.eng.call(
            s,
            m,
            &SearchRequest { search: "deck:*".into(), order: None },
        )?;
        Ok(resp.ids)
    }

    /// Review one specific card by id: fetch its scheduling states, then answer Good.
    /// We deliberately never call GetQueuedCards, so no in-memory queue is built and
    /// `answer_card`'s from_queue bookkeeping is a no-op — letting us review any card by id
    /// (the disjoint 10-and-10 sets §7b needs). `answered_at_ms` becomes the revlog id.
    fn review(&self, cid: i64, answered_at_ms: i64, rating: Rating) -> Result<()> {
        let (gs, gm) = self.idx.get("BackendSchedulerService", "GetSchedulingStates");
        let states: SchedulingStates = self.eng.call(gs, gm, &CardId { cid })?;
        let new_state = match rating {
            Rating::Again => states.again,
            Rating::Hard => states.hard,
            Rating::Good => states.good,
            Rating::Easy => states.easy,
        };
        let (as_, am) = self.idx.get("BackendSchedulerService", "AnswerCard");
        self.eng.run(
            as_,
            am,
            &CardAnswer {
                card_id: cid,
                current_state: states.current,
                new_state,
                rating: rating as i32,
                answered_at_millis: answered_at_ms,
                milliseconds_taken: 1500,
            }
            .encode_to_vec(),
        )?;
        Ok(())
    }

    fn card_mtime(&self, cid: i64) -> Result<i64> {
        let (s, m) = self.idx.get("BackendCardsService", "GetCard");
        let card: Card = self.eng.call(s, m, &CardId { cid })?;
        Ok(card.mtime_secs)
    }

    fn sync_collection(&self) -> Result<SyncCollectionResponse> {
        let (s, m) = self.idx.get("BackendSyncService", "SyncCollection");
        self.eng.call(
            s,
            m,
            &SyncCollectionRequest { auth: Some(self.auth()), sync_media: false },
        )
    }

    fn full_up_or_down(&self, upload: bool) -> Result<()> {
        let (s, m) = self.idx.get("BackendSyncService", "FullUploadOrDownload");
        self.eng.run(
            s,
            m,
            &FullUploadOrDownloadRequest {
                auth: Some(self.auth()),
                upload,
                server_usn: None,
            }
            .encode_to_vec(),
        )?;
        Ok(())
    }

    /// First-ever sync of a fresh collection: a normal sync reports a full sync is needed;
    /// perform it in the direction we intend (A uploads its seed, B downloads it).
    fn establish_full_sync(&self, upload: bool) -> Result<()> {
        let resp = self.sync_collection()?;
        match resp.required() {
            ChangesRequired::NoChanges | ChangesRequired::NormalSync => Ok(()),
            ChangesRequired::FullUpload
            | ChangesRequired::FullDownload
            | ChangesRequired::FullSync => self.full_up_or_down(upload),
        }
    }

    /// A normal (bidirectional) sync round; after it succeeds nothing more is required.
    fn sync(&self) -> Result<()> {
        let resp = self.sync_collection()?;
        match resp.required() {
            ChangesRequired::NoChanges | ChangesRequired::NormalSync => Ok(()),
            other => bail!("unexpected full sync required mid-test: {other:?}"),
        }
    }

    fn close(self) -> Result<()> {
        let (s, m) = self.idx.get("BackendCollectionService", "CloseCollection");
        self.eng
            .run(s, m, &CloseCollectionRequest { downgrade_to_schema11: false }.encode_to_vec())?;
        // Engine::drop closes the backend, flushing the .anki2 for the rusqlite asserts.
        Ok(())
    }
}

// ---- assertions read the .anki2 directly (backends are closed first) -----------------

fn revlog_ids(col: &Path) -> Result<Vec<i64>> {
    let conn = Connection::open(col)?;
    let mut stmt = conn.prepare("select id from revlog order by id")?;
    let ids = stmt
        .query_map([], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

fn card_mod(col: &Path, cid: i64) -> Result<i64> {
    let conn = Connection::open(col)?;
    Ok(conn.query_row("select mod from cards where id = ?1", [cid], |r| r.get(0))?)
}

// ---- the real anki-sync-server, spawned as a subprocess (docs/mcat/SYNC.md) ----------
// A subprocess (rather than an in-process runtime) keeps the server's Ctrl-C graceful-
// shutdown signal handling isolated from the backend's OWN tokio runtime; two tokio
// runtimes with signal drivers in one process make an in-process server flaky. This is
// also the more faithful reading of §7b's "start anki-sync-server".

struct TestServer {
    endpoint: String,
    child: Child,
    _base: tempfile::TempDir,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_server() -> Result<TestServer> {
    let bin = std::env::var("ANKI_SYNC_SERVER_BIN")
        .unwrap_or_else(|_| "out/rust/debug/anki-sync-server".to_string());
    let base = tempfile::tempdir()?;
    // Reserve a free localhost port, then hand it to the server.
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    let child = Command::new(&bin)
        .env("SYNC_USER1", "demo:demo") // one account: demo / demo
        .env("SYNC_HOST", "127.0.0.1")
        .env("SYNC_PORT", port.to_string())
        .env("SYNC_BASE", base.path())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            anyhow::anyhow!("spawning {bin} (build it: cargo build -p anki-sync-server): {e}")
        })?;
    let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
    // Wait until it is accepting connections.
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_err() {
        if std::time::Instant::now() > deadline {
            bail!("anki-sync-server never became reachable at {addr}");
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Ok(TestServer { endpoint: format!("http://{addr}/"), child, _base: base })
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64
}

// ---- the test -----------------------------------------------------------------------

#[test]
fn sync_7b_two_way_and_lww() -> Result<()> {
    let idx = Indices::load()?;
    let server = start_server()?;
    let endpoint = &server.endpoint;
    let workdir = tempfile::tempdir()?;
    let dir = workdir.path();
    let a_col = dir.join("A.anki2");
    let b_col = dir.join("B.anki2");
    let base = now_ms();

    // ---- Setup: seed A, upload; download into B; both share one server collection -----
    let ids;
    {
        let mut a = Device::open(dir, "A", &idx)?;
        a.login(endpoint)?; // (b) FFI sign-in with demo:demo against the real server
        let nt = a.basic_notetype_id()?;
        for i in 0..20 {
            a.add_note(nt, &format!("front {i}"))?;
        }
        a.establish_full_sync(true)?; // A uploads its 20-card seed
        ids = a.all_card_ids()?;
        assert_eq!(ids.len(), 20, "seed should have 20 cards");
        a.close()?;

        let mut b = Device::open(dir, "B", &idx)?;
        b.login(endpoint)?; // (b) the SECOND client, same credentials/URL
        b.establish_full_sync(false)?; // B downloads the shared collection
        let b_ids = b.all_card_ids()?;
        assert_eq!(
            BTreeSet::from_iter(b_ids.iter().copied()),
            BTreeSet::from_iter(ids.iter().copied()),
            "B must share A's exact card ids after full download"
        );
        b.close()?;
    }

    // ---- (c): 10 offline reviews on A + 10 DIFFERENT offline on B → sync → 20 land once
    {
        let mut a = Device::open(dir, "A", &idx)?;
        a.login(endpoint)?;
        let mut b = Device::open(dir, "B", &idx)?;
        b.login(endpoint)?;

        // Offline: no sync happens while these reviews are recorded. Disjoint answer-time
        // ranges keep the 20 revlog ids globally unique (A: base+0..9, B: base+100..109).
        for (i, cid) in ids[0..10].iter().enumerate() {
            a.review(*cid, base + i as i64, Rating::Good)?;
        }
        for (i, cid) in ids[10..20].iter().enumerate() {
            b.review(*cid, base + 100 + i as i64, Rating::Good)?;
        }

        // Reconnect + sync both ways. A pushes its 10; B pushes its 10 and pulls A's 10;
        // A pulls B's 10. A bidirectional normal sync sends and receives in one round.
        a.sync()?;
        b.sync()?;
        a.sync()?;
        a.close()?;
        b.close()?;
    }

    let a_ids = revlog_ids(&a_col)?;
    let b_ids = revlog_ids(&b_col)?;
    assert_eq!(a_ids.len(), 20, "A must hold all 20 reviews (none lost)");
    assert_eq!(b_ids.len(), 20, "B must hold all 20 reviews (none lost)");
    assert_eq!(a_ids, b_ids, "both collections converge to the same 20 revlog ids");
    assert_eq!(
        BTreeSet::from_iter(a_ids.iter().copied()).len(),
        20,
        "no revlog id is double-counted"
    );
    println!("(c) OK: 20 distinct reviews (10 offline on A + 10 offline on B) landed once on both sides");

    // ---- (d): same card edited offline on both → sync → later-mtime (LWW) winner -------
    let card0 = ids[0];
    let (a_mod, b_mod);
    {
        let mut a = Device::open(dir, "A", &idx)?;
        a.login(endpoint)?;
        let mut b = Device::open(dir, "B", &idx)?;
        b.login(endpoint)?;

        // A reviews card0 offline; then B reviews the SAME card0 offline strictly LATER.
        a.review(card0, base + 1_000_000, Rating::Good)?;
        a_mod = a.card_mtime(card0)?;
        // A card's `mod` is wall-clock SECONDS; sleeping >1s guarantees B's mod is greater,
        // so LWW-by-mtime has a single, deterministic winner (B).
        std::thread::sleep(Duration::from_millis(1200));
        b.review(card0, base + 1_005_000, Rating::Easy)?;
        b_mod = b.card_mtime(card0)?;
        assert!(
            b_mod > a_mod,
            "B must edit card0 strictly later (a_mod={a_mod}, b_mod={b_mod})"
        );

        a.sync()?; // A pushes card0 @ a_mod
        b.sync()?; // B pushes card0 @ b_mod (> a_mod ⇒ B wins on the server)
        a.sync()?; // A pulls the winning card0
        a.close()?;
        b.close()?;
    }

    let a_final = card_mod(&a_col, card0)?;
    let b_final = card_mod(&b_col, card0)?;
    assert_eq!(a_final, b_mod, "A converged to the later-mtime (LWW) winner");
    assert_eq!(b_final, b_mod, "B kept the later-mtime (LWW) winner");
    assert_ne!(a_final, a_mod, "the earlier edit did NOT win");
    // reviews remain append-only: 20 from (c) + 2 from (d)
    assert_eq!(revlog_ids(&a_col)?.len(), 22, "A: (c)'s 20 + (d)'s 2 reviews");
    assert_eq!(revlog_ids(&b_col)?.len(), 22, "B: (c)'s 20 + (d)'s 2 reviews");
    println!(
        "(d) OK: same-card offline edits resolved last-write-wins by mtime \
         (winner mod={b_mod}, loser mod={a_mod}) on both sides"
    );

    Ok(())
}
