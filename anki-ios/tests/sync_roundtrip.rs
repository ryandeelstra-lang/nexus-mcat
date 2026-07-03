// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up F1 host gate: two-way sync driven ENTIRELY through the 4-symbol FFI — the same
// bytes-in/bytes-out path the Swift app uses. The server is the real in-process `SimpleServer`
// (identical code to the `anki-sync-server` binary). This is the automated proof that a review on
// one device lands exactly once on the other, with none lost and none double-counted (§7b engine
// half), BEFORE any Swift is written.
use anki::collection::CollectionBuilder;
use anki::prelude::*;
use anki::scheduler::answering::{CardAnswer, Rating};
use anki::sync::http_server::{default_ip_header, SimpleServer, SyncServerConfig};
use anki_ios::{anki_buffer_free, anki_close_backend, anki_open_backend, anki_run_method, AnkiBuffer};
use prost::Message;

// Verified against the generated backend dispatch (out/rust/.../backend.rs run_service_method).
const SVC_SYNC: u32 = 1;
const M_SYNC_LOGIN: u32 = 3;
const M_SYNC_COLLECTION: u32 = 5;
const M_FULL_UP_OR_DOWN: u32 = 6;
const SVC_COLLECTION: u32 = 3;
const M_OPEN_COLLECTION: u32 = 0;
const SVC_STATS: u32 = 43;
const M_MASTERY_QUERY: u32 = 5;

struct Ffi(*mut anki::backend::Backend);

impl Ffi {
    fn open() -> Self {
        let init = anki_proto::backend::BackendInit {
            preferred_langs: vec!["en".into()],
            ..Default::default()
        }
        .encode_to_vec();
        let be = unsafe { anki_open_backend(init.as_ptr(), init.len()) };
        assert!(!be.is_null(), "anki_open_backend returned null");
        Ffi(be)
    }
    /// Run one RPC over the C ABI; Ok(bytes) on is_err=0, Err(err_bytes) on is_err=1; panic on 2.
    fn call(&self, svc: u32, method: u32, req: &[u8]) -> Result<Vec<u8>, Vec<u8>> {
        let mut is_err: u8 = 9;
        let buf: AnkiBuffer =
            unsafe { anki_run_method(self.0, svc, method, req.as_ptr(), req.len(), &mut is_err) };
        let bytes = if buf.ptr.is_null() {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(buf.ptr, buf.len).to_vec() }
        };
        unsafe { anki_buffer_free(buf) };
        match is_err {
            0 => Ok(bytes),
            1 => Err(bytes),
            other => panic!("FFI panic/refused: is_err={other}"),
        }
    }
    fn must(&self, svc: u32, method: u32, req: &[u8], what: &str) -> Vec<u8> {
        self.call(svc, method, req).unwrap_or_else(|e| {
            let be = anki_proto::backend::BackendError::decode(e.as_slice()).ok();
            panic!("{what} failed over FFI: {be:?}")
        })
    }
    fn open_collection(&self, dir: &std::path::Path, name: &str) {
        let req = anki_proto::collection::OpenCollectionRequest {
            collection_path: dir.join(format!("{name}.anki2")).to_string_lossy().into(),
            media_folder_path: dir.join(format!("{name}.media")).to_string_lossy().into(),
            media_db_path: dir.join(format!("{name}.media.db")).to_string_lossy().into(),
        }
        .encode_to_vec();
        self.must(SVC_COLLECTION, M_OPEN_COLLECTION, &req, "open_collection");
    }
    fn close_collection(&self) {
        let req = anki_proto::collection::CloseCollectionRequest {
            downgrade_to_schema11: false,
        }
        .encode_to_vec();
        self.must(SVC_COLLECTION, 1, &req, "close_collection");
    }
    fn login(&self, endpoint: &str) -> anki_proto::sync::SyncAuth {
        let req = anki_proto::sync::SyncLoginRequest {
            username: "demo".into(),
            password: "demo".into(),
            endpoint: Some(endpoint.into()),
        }
        .encode_to_vec();
        anki_proto::sync::SyncAuth::decode(
            self.must(SVC_SYNC, M_SYNC_LOGIN, &req, "sync_login").as_slice(),
        )
        .unwrap()
    }
    fn sync_collection(
        &self,
        auth: &anki_proto::sync::SyncAuth,
    ) -> anki_proto::sync::SyncCollectionResponse {
        let req = anki_proto::sync::SyncCollectionRequest {
            auth: Some(auth.clone()),
            sync_media: false,
        }
        .encode_to_vec();
        anki_proto::sync::SyncCollectionResponse::decode(
            self.must(SVC_SYNC, M_SYNC_COLLECTION, &req, "sync_collection").as_slice(),
        )
        .unwrap()
    }
    fn full_sync(&self, auth: &anki_proto::sync::SyncAuth, upload: bool) {
        let req = anki_proto::sync::FullUploadOrDownloadRequest {
            auth: Some(auth.clone()),
            upload,
            server_usn: None, // skip media
        }
        .encode_to_vec();
        self.must(SVC_SYNC, M_FULL_UP_OR_DOWN, &req, "full_upload_or_download");
    }
    /// Sum of graded revlog ROWS across topics — the give-up gate's unit (field 8, stats.proto:275).
    fn graded_reviews(&self) -> u32 {
        let req = anki_proto::stats::MasteryQueryRequest::default().encode_to_vec();
        let resp = anki_proto::stats::MasteryQueryResponse::decode(
            self.must(SVC_STATS, M_MASTERY_QUERY, &req, "mastery_query").as_slice(),
        )
        .unwrap();
        resp.topics.iter().map(|t| t.graded_reviews).sum()
    }
}

impl Drop for Ffi {
    fn drop(&mut self) {
        unsafe { anki_close_backend(self.0) };
    }
}

fn review_card(col: &mut anki::collection::Collection, cid: CardId, at: TimestampMillis) {
    let states = col.get_scheduling_states(cid).unwrap();
    col.answer_card(&mut CardAnswer {
        card_id: cid,
        current_state: states.current,
        new_state: states.good,
        rating: Rating::Good,
        answered_at: at,
        milliseconds_taken: 0,
        custom_data: None,
        from_queue: false,
    })
    .unwrap();
}

#[test]
fn ffi_two_way_sync_roundtrip() {
    // ---- in-process sync server (same code as the anki-sync-server binary)
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    std::env::set_var("SYNC_USER1", "demo:demo");
    let base = tempfile::tempdir().unwrap();
    let (addr, server_fut) = rt
        .block_on(SimpleServer::make_server(SyncServerConfig {
            host: "127.0.0.1".parse().unwrap(),
            port: 0,
            base_folder: base.path().into(),
            ip_header: default_ip_header(),
        }))
        .unwrap();
    rt.spawn(server_fut);
    let endpoint = format!("http://{addr}/");

    // ---- seed col1 NATIVELY: 2 cards, review card[0] "offline" (seeding is not under test)
    let dir = tempfile::tempdir().unwrap();
    let p1 = dir.path().join("col1.anki2");
    let mut col1 = CollectionBuilder::new(&p1).build().unwrap();
    let nt = col1.get_notetype_by_name("Basic").unwrap().unwrap();
    for i in 0..2 {
        let mut note = nt.new_note();
        note.set_field(0, format!("ffi front {i}")).unwrap();
        col1.add_note(&mut note, DeckId(1)).unwrap();
    }
    let cards = col1
        .search_cards("", anki::search::SortMode::NoOrder)
        .unwrap();
    assert_eq!(cards.len(), 2);
    review_card(&mut col1, cards[0], TimestampMillis::now());
    drop(col1); // release the SQLite handle before the FFI opens the same file

    // ---- PHONE-SIDE PATH (everything below is over the 4-symbol FFI)
    let ffi = Ffi::open();

    // "desktop" upload: open col1, login, sync -> full required -> full upload.
    // NOTE: full_sync_inner RE-OPENS the collection after the transfer (rslib backend/sync.rs:435),
    // so we must close_collection before opening a different file (else CollectionAlreadyOpen).
    ffi.open_collection(dir.path(), "col1");
    let auth = ffi.login(&endpoint);
    let resp = ffi.sync_collection(&auth);
    use anki_proto::sync::sync_collection_response::ChangesRequired;
    assert_ne!(resp.required(), ChangesRequired::NoChanges, "fresh server must need a full sync");
    ffi.full_sync(&auth, true);
    ffi.close_collection(); // col1 is re-opened by full_sync; release it before opening col2

    // "phone" download: open empty col2, login, sync -> full download
    ffi.open_collection(dir.path(), "col2");
    let resp = ffi.sync_collection(&auth);
    assert_ne!(resp.required(), ChangesRequired::NoChanges);
    ffi.full_sync(&auth, false); // full_sync re-opens col2 with the downloaded content
    assert_eq!(ffi.graded_reviews(), 1, "desktop review must arrive on the phone");

    // review the OTHER card on the "phone" natively (SQLite single-writer: close FFI handle first)
    drop(ffi);
    let p2 = dir.path().join("col2.anki2");
    let mut col2 = CollectionBuilder::new(&p2).build().unwrap();
    let cards2 = col2
        .search_cards("", anki::search::SortMode::NoOrder)
        .unwrap();
    review_card(&mut col2, cards2[1], TimestampMillis::now());
    drop(col2);

    // push phone -> server -> pull desktop, all over a fresh FFI backend
    let ffi = Ffi::open();
    ffi.open_collection(dir.path(), "col2");
    let resp = ffi.sync_collection(&auth);
    assert_eq!(resp.required(), ChangesRequired::NoChanges, "normal sync should complete");
    assert_eq!(ffi.graded_reviews(), 2);
    drop(ffi);

    let ffi = Ffi::open();
    ffi.open_collection(dir.path(), "col1");
    let resp = ffi.sync_collection(&auth);
    assert_eq!(resp.required(), ChangesRequired::NoChanges);
    assert_eq!(
        ffi.graded_reviews(),
        2,
        "TWO-WAY: both reviews land once on both sides over the FFI"
    );
}
