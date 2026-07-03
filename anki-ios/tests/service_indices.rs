// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the phone's hardcoded (service, method) coordinates against the REAL generated
// dispatch table (out/rust/.../backend.rs `run_service_method`). If Anki's service list ever
// shifts, this goes RED here — before the Swift app can misroute a call. The coordinates are also
// copied verbatim into ios-app/Sources/ServiceIndices.swift; edit BOTH together, never one.
//
// Invariant: indices stay stable only while `BackendStatsService` (and every other backend service
// list) is not appended to. Our one engine change (MasteryQuery) was added to the EMPTY
// BackendStatsService, keeping stats = 43 and every later index unmoved.
use anki::collection::CollectionBuilder;
use anki_ios::{anki_buffer_free, anki_close_backend, anki_open_backend, anki_run_method, AnkiBuffer};
use prost::Message;

fn call(be: *mut anki::backend::Backend, svc: u32, m: u32, req: &[u8]) -> (u8, Vec<u8>) {
    let mut is_err: u8 = 9;
    let buf: AnkiBuffer = unsafe { anki_run_method(be, svc, m, req.as_ptr(), req.len(), &mut is_err) };
    let bytes = if buf.ptr.is_null() {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(buf.ptr, buf.len).to_vec() }
    };
    unsafe { anki_buffer_free(buf) };
    (is_err, bytes)
}

#[test]
fn phone_service_indices_still_dispatch_to_the_right_methods() {
    let init = anki_proto::backend::BackendInit {
        preferred_langs: vec!["en".into()],
        ..Default::default()
    }
    .encode_to_vec();
    let be = unsafe { anki_open_backend(init.as_ptr(), init.len()) };
    assert!(!be.is_null());

    // open a real temp collection so collection-delegating services resolve
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("pin.anki2");
    drop(CollectionBuilder::new(&p).build().unwrap()); // create the file, release the lock
    let open = anki_proto::collection::OpenCollectionRequest {
        collection_path: p.to_string_lossy().into(),
        media_folder_path: dir.path().join("m").to_string_lossy().into(),
        media_db_path: dir.path().join("m.db").to_string_lossy().into(),
    }
    .encode_to_vec();
    assert_eq!(call(be, 3, 0, &open).0, 0, "(3,0) must be open_collection");

    // (7,7) = get_deck_id_by_name: the Default deck resolves to a DeckId
    let by_name = anki_proto::generic::String { val: "Default".into() }.encode_to_vec();
    let (e, bytes) = call(be, 7, 7, &by_name);
    assert_eq!(e, 0, "(7,7) must be get_deck_id_by_name");
    anki_proto::decks::DeckId::decode(bytes.as_slice()).unwrap();

    // (7,22) = set_current_deck: the Default deck (id 1) sets cleanly
    let did = anki_proto::decks::DeckId { did: 1 }.encode_to_vec();
    assert_eq!(call(be, 7, 22, &did).0, 0, "(7,22) must be set_current_deck");

    // (11,6) = get_deck_configs_for_update: DeckId -> DeckConfigsForUpdate (used to enable FSRS)
    let (e, bytes) = call(be, 11, 6, &did);
    assert_eq!(e, 0, "(11,6) must be get_deck_configs_for_update");
    anki_proto::deck_config::DeckConfigsForUpdate::decode(bytes.as_slice()).unwrap();

    // (39,2) = import_anki_package: a nonexistent package must ERROR (is_err=1), proving the call
    // reached import (a wrong index would fail to decode ImportAnkiPackageRequest instead)
    let bad_import = anki_proto::import_export::ImportAnkiPackageRequest {
        package_path: "/nonexistent-charged-up.apkg".into(),
        options: None,
    }
    .encode_to_vec();
    assert_eq!(call(be, 39, 2, &bad_import).0, 1, "(39,2) must be import_anki_package");

    // (43,5) = mastery_query: a default request must decode + return a decodable response
    let (e, bytes) = call(be, 43, 5, &anki_proto::stats::MasteryQueryRequest::default().encode_to_vec());
    assert_eq!(e, 0, "(43,5) must be mastery_query");
    anki_proto::stats::MasteryQueryResponse::decode(bytes.as_slice()).unwrap();

    // (13,3) = get_queued_cards: default request decodes + returns QueuedCards
    let (e, bytes) = call(be, 13, 3, &anki_proto::scheduler::GetQueuedCardsRequest::default().encode_to_vec());
    assert_eq!(e, 0, "(13,3) must be get_queued_cards");
    anki_proto::scheduler::QueuedCards::decode(bytes.as_slice()).unwrap();

    // (1,3) = sync_login: a dead endpoint must produce a NETWORK error (is_err=1), proving the
    // call reached sync_login (a wrong index would fail to decode SyncLoginRequest instead)
    let login = anki_proto::sync::SyncLoginRequest {
        username: "x".into(),
        password: "y".into(),
        endpoint: Some("http://127.0.0.1:1/".into()),
    }
    .encode_to_vec();
    let (e, err) = call(be, 1, 3, &login);
    assert_eq!(e, 1, "(1,3) must be sync_login (expected a network error, not a panic)");
    let err = anki_proto::backend::BackendError::decode(err.as_slice()).unwrap();
    assert_eq!(err.kind(), anki_proto::backend::backend_error::Kind::NetworkError);

    // out-of-range coordinates fail closed (never a panic)
    assert_eq!(call(be, 1, 99, &[]).0, 1, "invalid method index errors cleanly");
    assert_eq!(call(be, 99, 0, &[]).0, 1, "invalid service index errors cleanly");

    unsafe { anki_close_backend(be) };
}
