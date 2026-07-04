// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up host gate: the review WRITE path driven ENTIRELY through the 4-symbol FFI — the same
// bytes-in/bytes-out path the Swift app uses when the player grades a card (AnkiEngine.answer():
// a CardAnswer built from get_queued_cards' states, rating + answered_at + milliseconds_taken).
// service_indices pins the (13,3)/(13,4) coordinates; THIS proves the semantics: one FFI answer
// writes exactly one revlog row for that card and advances the card's scheduling state.
use anki::collection::CollectionBuilder;
use anki::prelude::*;
use anki_ios::{anki_buffer_free, anki_close_backend, anki_open_backend, anki_run_method, AnkiBuffer};
use prost::Message;

// Verified against the generated backend dispatch (out/rust/.../backend.rs run_service_method).
const SVC_COLLECTION: u32 = 3;
const M_OPEN_COLLECTION: u32 = 0;
const SVC_CARDS: u32 = 5;
const M_GET_CARD: u32 = 0;
const SVC_SCHEDULER: u32 = 13;
const M_GET_QUEUED_CARDS: u32 = 3;
const M_ANSWER_CARD: u32 = 4;
const SVC_STATS: u32 = 43;
const M_GET_REVIEW_LOGS: u32 = 1;

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
    /// (43,1) = get_review_logs: every revlog row for ONE card, straight over the FFI.
    fn review_logs(&self, cid: i64) -> anki_proto::stats::ReviewLogs {
        let req = anki_proto::cards::CardId { cid }.encode_to_vec();
        anki_proto::stats::ReviewLogs::decode(
            self.must(SVC_STATS, M_GET_REVIEW_LOGS, &req, "get_review_logs").as_slice(),
        )
        .unwrap()
    }
}

impl Drop for Ffi {
    fn drop(&mut self) {
        unsafe { anki_close_backend(self.0) };
    }
}

#[test]
fn ffi_answer_card_writes_exactly_one_review() {
    // ---- seed NATIVELY: 1 note in the Default deck (seeding is not under test)
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("col.anki2");
    let mut col = CollectionBuilder::new(&p).build().unwrap();
    let nt = col.get_notetype_by_name("Basic").unwrap().unwrap();
    let mut note = nt.new_note();
    note.set_field(0, "ffi answer front").unwrap();
    col.add_note(&mut note, DeckId(1)).unwrap();
    drop(col); // release the SQLite handle before the FFI opens the same file

    // ---- PHONE-SIDE PATH (everything below is over the 4-symbol FFI)
    let ffi = Ffi::open();
    ffi.open_collection(dir.path(), "col");

    // (13,3) get_queued_cards: the seeded card comes back with its scheduling states
    let req = anki_proto::scheduler::GetQueuedCardsRequest {
        fetch_limit: 1,
        ..Default::default()
    }
    .encode_to_vec();
    let queued = anki_proto::scheduler::QueuedCards::decode(
        ffi.must(SVC_SCHEDULER, M_GET_QUEUED_CARDS, &req, "get_queued_cards").as_slice(),
    )
    .unwrap();
    let qc = queued.cards.first().expect("the seeded card must be queued").clone();
    let before = qc.card.expect("queued card carries the full card");
    let states = qc.states.expect("queued card carries scheduling states");
    assert_eq!(before.reps, 0, "fresh card: no reviews yet");
    assert!(ffi.review_logs(before.id).entries.is_empty(), "fresh card: empty revlog");

    // (13,4) answer_card: a real CardAnswer exactly as AnkiEngine.swift answer() builds it —
    // current state from the queue, the Good branch's new state, rating + answered_at + ms taken
    let ans = anki_proto::scheduler::CardAnswer {
        card_id: before.id,
        current_state: states.current,
        new_state: states.good,
        rating: anki_proto::scheduler::card_answer::Rating::Good as i32,
        answered_at_millis: TimestampMillis::now().0,
        milliseconds_taken: 1_500,
    }
    .encode_to_vec();
    let changes = anki_proto::collection::OpChanges::decode(
        ffi.must(SVC_SCHEDULER, M_ANSWER_CARD, &ans, "answer_card").as_slice(),
    )
    .unwrap();
    assert!(changes.card, "answer_card must report the card changed");

    // the revlog gained EXACTLY one row for that card (read back over the same FFI)
    let logs = ffi.review_logs(before.id);
    assert_eq!(logs.entries.len(), 1, "one FFI answer = exactly one revlog row");
    assert_eq!(logs.entries[0].button_chosen, 3, "Good is recorded as button 3");

    // (5,0) get_card: the card's scheduling state advanced (New -> learning, one rep)
    let cid_req = anki_proto::cards::CardId { cid: before.id }.encode_to_vec();
    let after = anki_proto::cards::Card::decode(
        ffi.must(SVC_CARDS, M_GET_CARD, &cid_req, "get_card").as_slice(),
    )
    .unwrap();
    assert_eq!(after.reps, 1, "exactly one review recorded on the card");
    assert_ne!(after.ctype, before.ctype, "the card left the New state");
}
