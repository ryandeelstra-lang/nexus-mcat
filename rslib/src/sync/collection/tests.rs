// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

#![cfg(test)]

use std::future::Future;
use std::sync::LazyLock;

use axum::http::StatusCode;
use reqwest::Client;
use reqwest::Url;
use serde_json::json;
use tempfile::tempdir;
use tempfile::TempDir;
use tokio::sync::Mutex;
use tokio::sync::MutexGuard;
use tracing::Instrument;
use tracing::Span;
use wiremock::matchers::method;
use wiremock::matchers::path;
use wiremock::Mock;
use wiremock::MockServer;
use wiremock::ResponseTemplate;

use crate::card::CardQueue;
use crate::collection::CollectionBuilder;
use crate::deckconfig::DeckConfig;
use crate::decks::DeckKind;
use crate::error::SyncError;
use crate::error::SyncErrorKind;
use crate::log::set_global_logger;
use crate::notetype::all_stock_notetypes;
use crate::prelude::*;
use crate::revlog::RevlogEntry;
use crate::search::SortMode;
use crate::sync::collection::graves::ApplyGravesRequest;
use crate::sync::collection::meta::MetaRequest;
use crate::sync::collection::normal::NormalSyncer;
use crate::sync::collection::normal::SyncActionRequired;
use crate::sync::collection::normal::SyncOutput;
use crate::sync::collection::protocol::EmptyInput;
use crate::sync::collection::protocol::SyncProtocol;
use crate::sync::collection::start::StartRequest;
use crate::sync::collection::upload::UploadResponse;
use crate::sync::collection::upload::CORRUPT_MESSAGE;
use crate::sync::http_client::HttpSyncClient;
use crate::sync::http_server::default_ip_header;
use crate::sync::http_server::SimpleServer;
use crate::sync::http_server::SyncServerConfig;
use crate::sync::login::HostKeyRequest;
use crate::sync::login::SyncAuth;
use crate::sync::request::IntoSyncRequest;

struct TestAuth {
    username: String,
    password: String,
    host_key: String,
}

static AUTH: LazyLock<TestAuth> = LazyLock::new(|| {
    if let Ok(auth) = std::env::var("TEST_AUTH") {
        let mut auth = auth.split(':');
        TestAuth {
            username: auth.next().unwrap().into(),
            password: auth.next().unwrap().into(),
            host_key: auth.next().unwrap().into(),
        }
    } else {
        TestAuth {
            username: "user".to_string(),
            password: "pass".to_string(),
            host_key: "b2619aa1529dfdc4248e6edbf3c1b2a2b014cf6d".to_string(),
        }
    }
});

pub(in crate::sync) async fn with_active_server<F, O>(op: F) -> Result<()>
where
    F: FnOnce(HttpSyncClient) -> O,
    O: Future<Output = Result<()>>,
{
    let _ = set_global_logger(None);
    // start server
    let base_folder = tempdir()?;
    std::env::set_var("SYNC_USER1", "user:pass");
    let (addr, server_fut) = SimpleServer::make_server(SyncServerConfig {
        host: "127.0.0.1".parse().unwrap(),
        port: 0,
        base_folder: base_folder.path().into(),
        ip_header: default_ip_header(),
    })
    .await
    .unwrap();
    tokio::spawn(server_fut.instrument(Span::current()));
    // when not using ephemeral servers, tests need to be serialized
    static LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
    let _lock: MutexGuard<()>;
    // setup client to connect to it
    let endpoint = if let Ok(endpoint) = std::env::var("TEST_ENDPOINT") {
        _lock = LOCK.lock().await;
        endpoint
    } else {
        format!("http://{addr}/")
    };
    let endpoint = Url::try_from(endpoint.as_str()).unwrap();
    let auth = SyncAuth {
        hkey: AUTH.host_key.clone(),
        endpoint: Some(endpoint),
        io_timeout_secs: None,
    };
    let client = HttpSyncClient::new(auth, Client::new());
    op(client).await
}

fn unwrap_sync_err_kind(err: AnkiError) -> SyncErrorKind {
    let AnkiError::SyncError {
        source: SyncError { kind, .. },
    } = err
    else {
        panic!("not sync err: {err:?}");
    };
    kind
}

#[tokio::test]
async fn host_key() -> Result<()> {
    with_active_server(|mut client| async move {
        let err = client
            .host_key(
                HostKeyRequest {
                    username: "bad".to_string(),
                    password: "bad".to_string(),
                }
                .try_into_sync_request()?,
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, StatusCode::FORBIDDEN);
        assert_eq!(
            unwrap_sync_err_kind(AnkiError::from(err)),
            SyncErrorKind::AuthFailed
        );
        // hkey should be automatically set after successful login
        client.sync_key = String::new();
        let resp = client
            .host_key(
                HostKeyRequest {
                    username: AUTH.username.clone(),
                    password: AUTH.password.clone(),
                }
                .try_into_sync_request()?,
            )
            .await?
            .json()?;
        assert_eq!(resp.key, *AUTH.host_key);
        Ok(())
    })
    .await
}

#[tokio::test]
async fn meta() -> Result<()> {
    with_active_server(|client| async move {
        // unsupported sync version
        assert_eq!(
            SyncProtocol::meta(
                &client,
                MetaRequest {
                    sync_version: 0,
                    client_version: "".to_string(),
                }
                .try_into_sync_request()?,
            )
            .await
            .unwrap_err()
            .code,
            StatusCode::NOT_IMPLEMENTED
        );

        Ok(())
    })
    .await
}

#[tokio::test]
async fn aborting_is_idempotent() -> Result<()> {
    with_active_server(|mut client| async move {
        // abort is a no-op if no sync in progress
        client.abort(EmptyInput::request()).await?;

        // start a sync
        let _graves = client
            .start(
                StartRequest {
                    client_usn: Default::default(),
                    local_is_newer: false,
                    deprecated_client_graves: None,
                }
                .try_into_sync_request()?,
            )
            .await?;

        // an abort request with the wrong key is ignored
        let orig_key = client.skey().to_string();
        client.set_skey("aabbccdd".into());
        client.abort(EmptyInput::request()).await?;

        // it should succeed with the correct key
        client.set_skey(orig_key);
        client.abort(EmptyInput::request()).await?;
        Ok(())
    })
    .await
}

#[tokio::test]
async fn new_syncs_cancel_old_ones() -> Result<()> {
    with_active_server(|mut client| async move {
        let ctx = SyncTestContext::new(client.clone());

        // start a sync
        let req = StartRequest {
            client_usn: Default::default(),
            local_is_newer: false,
            deprecated_client_graves: None,
        }
        .try_into_sync_request()?;
        let _ = client.start(req.clone()).await?;

        // a new sync aborts the previous one
        let orig_key = client.skey().to_string();
        client.set_skey("1".into());
        let _ = client.start(req.clone()).await?;

        // old sync can no longer proceed
        client.set_skey(orig_key);
        let graves_req = ApplyGravesRequest::default().try_into_sync_request()?;
        assert_eq!(
            client
                .apply_graves(graves_req.clone())
                .await
                .unwrap_err()
                .code,
            StatusCode::CONFLICT
        );

        // with the correct key, it can continue
        client.set_skey("1".into());
        client.apply_graves(graves_req.clone()).await?;
        // but a full upload will break the lock
        ctx.full_upload(ctx.col1()).await;
        assert_eq!(
            client
                .apply_graves(graves_req.clone())
                .await
                .unwrap_err()
                .code,
            StatusCode::CONFLICT
        );

        // likewise with download
        let _ = client.start(req.clone()).await?;
        ctx.full_download(ctx.col1()).await;
        assert_eq!(
            client
                .apply_graves(graves_req.clone())
                .await
                .unwrap_err()
                .code,
            StatusCode::CONFLICT
        );

        Ok(())
    })
    .await
}

#[tokio::test]
async fn sync_roundtrip() -> Result<()> {
    with_active_server(|client| async move {
        let ctx = SyncTestContext::new(client);
        upload_download(&ctx).await?;
        regular_sync(&ctx).await?;
        Ok(())
    })
    .await
}

#[tokio::test]
async fn sanity_check_should_roll_back_and_force_full_sync() -> Result<()> {
    with_active_server(|client| async move {
        let ctx = SyncTestContext::new(client);
        upload_download(&ctx).await?;

        let mut col1 = ctx.col1();

        // add a deck but don't mark it as requiring a sync, which will trigger the
        // sanity check to fail
        let mut deck = col1.get_or_create_normal_deck("unsynced deck")?;
        col1.add_or_update_deck(&mut deck)?;
        col1.storage
            .db
            .execute("update decks set usn=0 where id=?", [deck.id])?;

        // the sync should fail
        let err = NormalSyncer::new(&mut col1, ctx.cloned_client())
            .sync()
            .await
            .unwrap_err();
        assert!(matches!(
            err,
            AnkiError::SyncError {
                source: SyncError {
                    kind: SyncErrorKind::SanityCheckFailed { .. },
                    ..
                }
            }
        ));

        // the server should have rolled back
        let mut col2 = ctx.col2();
        let out = ctx.normal_sync(&mut col2).await;
        assert_eq!(out.required, SyncActionRequired::NoChanges);

        // and the client should have forced a one-way sync
        let out = ctx.normal_sync(&mut col1).await;
        assert_eq!(
            out.required,
            SyncActionRequired::FullSyncRequired {
                upload_ok: true,
                download_ok: true,
            }
        );

        Ok(())
    })
    .await
}

#[tokio::test]
async fn sync_errors_should_prompt_db_check() -> Result<()> {
    with_active_server(|client| async move {
        let ctx = SyncTestContext::new(client);
        upload_download(&ctx).await?;

        let mut col1 = ctx.col1();

        // Add a a new notetype, and a note that uses it, but don't mark the notetype as
        // requiring a sync, which will cause the sync to fail as the note is added.
        let mut nt = all_stock_notetypes(&col1.tr).remove(0);
        nt.name = "new".into();
        col1.add_notetype(&mut nt, false)?;
        let mut note = nt.new_note();
        note.set_field(0, "test")?;
        col1.add_note(&mut note, DeckId(1))?;
        col1.storage.db.execute("update notetypes set usn=0", [])?;

        // the sync should fail
        let err = NormalSyncer::new(&mut col1, ctx.cloned_client())
            .sync()
            .await
            .unwrap_err();
        let AnkiError::SyncError {
            source: SyncError { info: _, kind },
        } = err
        else {
            panic!()
        };
        assert_eq!(kind, SyncErrorKind::DatabaseCheckRequired);

        // the server should have rolled back
        let mut col2 = ctx.col2();
        let out = ctx.normal_sync(&mut col2).await;
        assert_eq!(out.required, SyncActionRequired::NoChanges);

        // and the client should be able to sync again without a forced one-way sync
        let err = NormalSyncer::new(&mut col1, ctx.cloned_client())
            .sync()
            .await
            .unwrap_err();
        let AnkiError::SyncError {
            source: SyncError { info: _, kind },
        } = err
        else {
            panic!()
        };
        assert_eq!(kind, SyncErrorKind::DatabaseCheckRequired);

        Ok(())
    })
    .await
}

/// Old AnkiMobile versions sent grave ids as strings
#[tokio::test]
async fn string_grave_ids_are_handled() -> Result<()> {
    with_active_server(|client| async move {
        let req = json!({
            "minUsn": 0,
            "lnewer": false,
            "graves": {
                "cards": vec!["1"],
                "decks": vec!["2", "3"],
                "notes": vec!["4"],
            }
        });
        let req = serde_json::to_vec(&req)
            .unwrap()
            .try_into_sync_request()
            .unwrap();
        // should not return err 400
        client.start(req.into_output_type()).await.unwrap();
        client.abort(EmptyInput::request()).await?;
        Ok(())
    })
    .await?;
    // a missing value should be handled
    with_active_server(|client| async move {
        let req = json!({
            "minUsn": 0,
            "lnewer": false,
        });
        let req = serde_json::to_vec(&req)
            .unwrap()
            .try_into_sync_request()
            .unwrap();
        client.start(req.into_output_type()).await.unwrap();
        client.abort(EmptyInput::request()).await?;
        Ok(())
    })
    .await
}

#[tokio::test]
async fn invalid_uploads_should_be_handled() -> Result<()> {
    with_active_server(|client| async move {
        let ctx = SyncTestContext::new(client);
        let res = ctx
            .client
            .upload(b"fake data".to_vec().try_into_sync_request()?)
            .await?;
        assert_eq!(
            res.upload_response(),
            UploadResponse::Err(CORRUPT_MESSAGE.into())
        );
        Ok(())
    })
    .await
}

#[tokio::test]
async fn meta_redirect_is_handled() -> Result<()> {
    with_active_server(|client| async move {
        let mock_server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/sync/meta"))
            .respond_with(
                ResponseTemplate::new(308).insert_header("location", client.endpoint.as_str()),
            )
            .mount(&mock_server)
            .await;
        // starting from in-sync state
        let mut ctx = SyncTestContext::new(client);
        upload_download(&ctx).await?;
        // add another note to trigger a normal sync
        let mut col1 = ctx.col1();
        col1_setup(&mut col1);
        // switch to bad endpoint
        let orig_url = ctx.client.endpoint.to_string();
        ctx.client.endpoint = Url::try_from(mock_server.uri().as_str()).unwrap();
        // sync should succeed
        let out = ctx.normal_sync(&mut col1).await;
        // client should have received new endpoint
        assert_eq!(out.new_endpoint, Some(orig_url));
        // client should not have tried the old endpoint more than once
        assert_eq!(mock_server.received_requests().await.unwrap().len(), 1);
        Ok(())
    })
    .await
}

pub(in crate::sync) struct SyncTestContext {
    pub folder: TempDir,
    pub client: HttpSyncClient,
}

impl SyncTestContext {
    pub fn new(client: HttpSyncClient) -> Self {
        Self {
            folder: tempdir().expect("create temp dir"),
            client,
        }
    }

    pub fn col1(&self) -> Collection {
        let base = self.folder.path();
        CollectionBuilder::new(base.join("col1.anki2"))
            .with_desktop_media_paths()
            .build()
            .unwrap()
    }

    pub fn col2(&self) -> Collection {
        let base = self.folder.path();
        CollectionBuilder::new(base.join("col2.anki2"))
            .with_desktop_media_paths()
            .build()
            .unwrap()
    }

    async fn normal_sync(&self, col: &mut Collection) -> SyncOutput {
        NormalSyncer::new(col, self.cloned_client())
            .sync()
            .await
            .unwrap()
    }

    async fn full_upload(&self, col: Collection) {
        col.full_upload_with_server(self.cloned_client())
            .await
            .unwrap()
    }

    async fn full_download(&self, col: Collection) {
        col.full_download_with_server(self.cloned_client())
            .await
            .unwrap()
    }

    fn cloned_client(&self) -> HttpSyncClient {
        self.client.clone()
    }
}

// Setup + full syncs
/////////////////////

fn col1_setup(col: &mut Collection) {
    let nt = col.get_notetype_by_name("Basic").unwrap().unwrap();
    let mut note = nt.new_note();
    note.set_field(0, "1").unwrap();
    col.add_note(&mut note, DeckId(1)).unwrap();
}

async fn upload_download(ctx: &SyncTestContext) -> Result<()> {
    let mut col1 = ctx.col1();
    col1_setup(&mut col1);

    let out = ctx.normal_sync(&mut col1).await;
    assert!(matches!(
        out.required,
        SyncActionRequired::FullSyncRequired { .. }
    ));

    ctx.full_upload(col1).await;

    // another collection
    let mut col2 = ctx.col2();

    // won't allow ankiweb clobber
    let out = ctx.normal_sync(&mut col2).await;
    assert_eq!(
        out.required,
        SyncActionRequired::FullSyncRequired {
            upload_ok: false,
            download_ok: true,
        }
    );

    // fetch so we're in sync
    ctx.full_download(col2).await;

    Ok(())
}

// Regular syncs
/////////////////////

async fn regular_sync(ctx: &SyncTestContext) -> Result<()> {
    // add a deck
    let mut col1 = ctx.col1();
    let mut col2 = ctx.col2();

    let mut deck = col1.get_or_create_normal_deck("new deck")?;

    // give it a new option group
    let mut dconf = DeckConfig {
        name: "new dconf".into(),
        ..Default::default()
    };
    col1.add_or_update_deck_config(&mut dconf)?;
    if let DeckKind::Normal(deck) = &mut deck.kind {
        deck.config_id = dconf.id.0;
    }
    col1.add_or_update_deck(&mut deck)?;

    // and a new notetype
    let mut nt = all_stock_notetypes(&col1.tr).remove(0);
    nt.name = "new".into();
    col1.add_notetype(&mut nt, false)?;

    // add another note+card+tag
    let mut note = nt.new_note();
    note.set_field(0, "2")?;
    note.tags.push("tag".into());
    col1.add_note(&mut note, deck.id)?;

    // mock revlog entry
    col1.storage.add_revlog_entry(
        &RevlogEntry {
            id: RevlogId(123),
            cid: CardId(456),
            usn: Usn(-1),
            interval: 10,
            ..Default::default()
        },
        true,
    )?;

    // config + creation
    col1.set_config("test", &"test1")?;
    // bumping this will affect 'last studied at' on decks at the moment
    // col1.storage.set_creation_stamp(TimestampSecs(12345))?;

    // and sync our changes
    let remote_meta = ctx
        .client
        .meta(MetaRequest::request())
        .await
        .unwrap()
        .json()
        .unwrap();
    let out = col1.sync_meta()?.compared_to_remote(remote_meta, None);
    assert_eq!(out.required, SyncActionRequired::NormalSyncRequired);

    let out = ctx.normal_sync(&mut col1).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);

    // sync the other collection
    let out = ctx.normal_sync(&mut col2).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);

    let ntid = nt.id;
    let deckid = deck.id;
    let dconfid = dconf.id;
    let noteid = note.id;
    let cardid = col1.search_cards(note.id, SortMode::NoOrder)?[0];
    let revlogid = RevlogId(123);

    let compare_sides = |col1: &mut Collection, col2: &mut Collection| -> Result<()> {
        assert_eq!(
            col1.get_notetype(ntid)?.unwrap(),
            col2.get_notetype(ntid)?.unwrap()
        );
        assert_eq!(
            col1.get_deck(deckid)?.unwrap(),
            col2.get_deck(deckid)?.unwrap()
        );
        assert_eq!(
            col1.get_deck_config(dconfid, false)?.unwrap(),
            col2.get_deck_config(dconfid, false)?.unwrap()
        );
        assert_eq!(
            col1.storage.get_note(noteid)?.unwrap(),
            col2.storage.get_note(noteid)?.unwrap()
        );
        assert_eq!(
            col1.storage.get_card(cardid)?.unwrap(),
            col2.storage.get_card(cardid)?.unwrap()
        );
        assert_eq!(
            col1.storage.get_revlog_entry(revlogid)?,
            col2.storage.get_revlog_entry(revlogid)?,
        );
        assert_eq!(
            col1.storage.get_all_config()?,
            col2.storage.get_all_config()?
        );
        assert_eq!(
            col1.storage.creation_stamp()?,
            col2.storage.creation_stamp()?
        );

        // server doesn't send tag usns, so we can only compare tags, not usns,
        // as the usns may not match
        assert_eq!(
            col1.storage
                .all_tags()?
                .into_iter()
                .map(|t| t.name)
                .collect::<Vec<_>>(),
            col2.storage
                .all_tags()?
                .into_iter()
                .map(|t| t.name)
                .collect::<Vec<_>>()
        );
        std::thread::sleep(std::time::Duration::from_millis(1));
        Ok(())
    };

    // make sure everything has been transferred across
    compare_sides(&mut col1, &mut col2)?;

    // make some modifications
    let mut note = col2.storage.get_note(note.id)?.unwrap();
    note.set_field(1, "new")?;
    note.tags.push("tag2".into());
    col2.update_note(&mut note)?;

    col2.get_and_update_card(cardid, |card| {
        card.queue = CardQueue::Review;
        Ok(())
    })?;

    let mut deck = col2.storage.get_deck(deck.id)?.unwrap();
    deck.name = NativeDeckName::from_native_str("newer");
    col2.add_or_update_deck(&mut deck)?;

    let mut nt = col2.storage.get_notetype(nt.id)?.unwrap();
    nt.name = "newer".into();
    col2.update_notetype(&mut nt, false)?;

    // sync the changes back
    let out = ctx.normal_sync(&mut col2).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);
    let out = ctx.normal_sync(&mut col1).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);

    // should still match
    compare_sides(&mut col1, &mut col2)?;

    // deletions should sync too
    for table in &["cards", "notes", "decks"] {
        assert_eq!(
            col1.storage
                .db_scalar::<u8>(&format!("select count() from {table}"))?,
            2
        );
    }

    // fixme: inconsistent usn arg
    std::thread::sleep(std::time::Duration::from_millis(1));
    col1.remove_cards_and_orphaned_notes(&[cardid])?;
    let usn = col1.usn()?;
    col1.remove_note_only_undoable(noteid, usn)?;
    col1.remove_decks_and_child_decks(&[deckid])?;

    let out = ctx.normal_sync(&mut col1).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);
    let out = ctx.normal_sync(&mut col2).await;
    assert_eq!(out.required, SyncActionRequired::NoChanges);

    for table in &["cards", "notes", "decks"] {
        assert_eq!(
            col2.storage
                .db_scalar::<u8>(&format!("select count() from {table}"))?,
            1
        );
    }

    // removing things like a notetype forces a full sync
    std::thread::sleep(std::time::Duration::from_millis(1));
    col2.remove_notetype(ntid)?;
    let out = ctx.normal_sync(&mut col2).await;
    assert!(matches!(
        out.required,
        SyncActionRequired::FullSyncRequired { .. }
    ));
    Ok(())
}

// ===================================================================================================
// MCAT fork — Block E: sync without loss / double-count + LWW conflict (charged_up)
// ===================================================================================================
//
// Appended, additive tests only. No existing test above is modified and NO engine source is changed:
// Anki's append-only revlog (dedup by the millisecond `RevlogId` PK, `INSERT OR IGNORE`) and its
// mtime last-write-wins merge already provide the behavior the MCAT rubric requires. These tests PIN
// that behavior against the real in-process `anki-sync-server` harness and lock it as a regression
// gate. The documented conflict rule (D7) lives in docs/mcat/CONFLICT-RULE.md.
//
// Requirement map (docs 03/19, Decision 9):
//   t3_revlog_dedup_primitive           -> 7b / C6 / I1  (the SQLite INSERT-OR-IGNORE primitive; hardening L4)
//   t2_two_collection_roundtrip         -> C6 / 7b       (state round-trips across two collections)
//   t4_twenty_reviews_land_once         -> 7b / C6       (the headline: 10 + 10 distinct -> 20 land once)
//   s1_conflict_lww_by_mtime            -> D7 / 7b       (same object on both -> later mtime wins)
//   c7_offline_review_then_reconnect    -> C7 / 7b       (offline reviews land on reconnect)
//   s2b_midsync_interrupt_is_clean      -> 7g / C7 / I1  (interrupted sync + replay -> no loss/double)
//   s2c_wrong_clock_revlog_id_collision -> I1 / D7       (honest clock-skew limitation: one row survives)
#[cfg(test)]
mod mcat_block_e {
    use std::collections::HashSet;

    use super::*;
    use crate::scheduler::answering::CardAnswer;
    use crate::scheduler::answering::Rating;

    // ---- helpers ----------------------------------------------------------------------------------

    /// Review a card by id with an explicit answer time (which becomes the revlog id), without
    /// requiring the in-memory study queue (`from_queue: false`). A revlog row with id == `at` is
    /// written and the collection is marked modified, so the next normal sync pushes it.
    fn review_card(col: &mut Collection, cid: CardId, at: TimestampMillis) -> Result<()> {
        let states = col.get_scheduling_states(cid)?;
        col.answer_card(&mut CardAnswer {
            card_id: cid,
            current_state: states.current,
            new_state: states.good,
            rating: Rating::Good,
            answered_at: at,
            milliseconds_taken: 0,
            custom_data: None,
            from_queue: false,
        })?;
        Ok(())
    }

    /// Add `n` distinct Basic notes (deck 1). Card ids are re-queried by callers after sync.
    fn seed_cards(col: &mut Collection, n: usize) {
        let nt = col.get_notetype_by_name("Basic").unwrap().unwrap();
        for i in 0..n {
            let mut note = nt.new_note();
            note.set_field(0, format!("front {i}")).unwrap();
            col.add_note(&mut note, DeckId(1)).unwrap();
        }
    }

    fn revlog_count(col: &Collection) -> Result<u32> {
        col.storage.db_scalar::<u32>("select count() from revlog")
    }

    /// Every revlog id in the collection, ascending — for set/equality assertions.
    fn sorted_revlog_ids(col: &Collection) -> Result<Vec<i64>> {
        let mut ids: Vec<i64> = col
            .storage
            .get_all_revlog_entries(TimestampSecs(0))?
            .into_iter()
            .map(|e| e.id.0)
            .collect();
        ids.sort_unstable();
        Ok(ids)
    }

    // ---- T3: the revlog dedup PRIMITIVE -----------------------------------------------------------
    // Pins ONLY the storage-layer primitive the sync MERGE path relies on (`merge_revlog` calls
    // `add_revlog_entry(.., false)`): the same id inserted twice lands once; distinct ids land twice;
    // and two DIFFERENT reviews of the SAME card (distinct ids) BOTH persist — dedup is keyed on the
    // revlog id, never on the card. The cross-device merge invariant itself is T4/s2c. (hardening L4)
    #[test]
    fn t3_revlog_dedup_primitive() -> Result<()> {
        let col = Collection::new();
        assert_eq!(revlog_count(&col)?, 0);

        let entry = RevlogEntry {
            id: RevlogId(1_000),
            cid: CardId(1),
            usn: Usn(-1),
            interval: 5,
            ..Default::default()
        };
        // first insert on the merge path lands
        assert_eq!(
            col.storage.add_revlog_entry(&entry, false)?,
            Some(RevlogId(1_000))
        );
        // the SAME id again is silently dropped (INSERT OR IGNORE) — no double-count
        assert_eq!(col.storage.add_revlog_entry(&entry, false)?, None);
        assert_eq!(revlog_count(&col)?, 1);

        // a DISTINCT id lands as a second row
        let other = RevlogEntry {
            id: RevlogId(1_001),
            ..entry.clone()
        };
        assert_eq!(
            col.storage.add_revlog_entry(&other, false)?,
            Some(RevlogId(1_001))
        );
        assert_eq!(revlog_count(&col)?, 2);

        // L4 corner: the SAME card reviewed twice (two different ms ids, same cid) keeps BOTH rows
        let same_card = CardId(99);
        let a = RevlogEntry {
            id: RevlogId(2_000),
            cid: same_card,
            ..Default::default()
        };
        let b = RevlogEntry {
            id: RevlogId(2_001),
            cid: same_card,
            ..Default::default()
        };
        assert_eq!(
            col.storage.add_revlog_entry(&a, false)?,
            Some(RevlogId(2_000))
        );
        assert_eq!(
            col.storage.add_revlog_entry(&b, false)?,
            Some(RevlogId(2_001))
        );
        assert_eq!(revlog_count(&col)?, 4);
        assert_eq!(sorted_revlog_ids(&col)?, vec![1_000, 1_001, 2_000, 2_001]);
        Ok(())
    }

    // ---- T2: two-collection round-trip ------------------------------------------------------------
    #[tokio::test]
    async fn t2_two_collection_roundtrip() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client);
            upload_download(&ctx).await?; // col1 has 1 note, uploaded; col2 full-downloaded -> in sync

            // add a NEW note on col1 and push it via a normal sync
            let mut col1 = ctx.col1();
            col1_setup(&mut col1);
            let out = ctx.normal_sync(&mut col1).await;
            assert_eq!(out.required, SyncActionRequired::NoChanges);

            // pull into col2; the note count must match on BOTH sides
            let mut col2 = ctx.col2();
            let out = ctx.normal_sync(&mut col2).await;
            assert_eq!(out.required, SyncActionRequired::NoChanges);

            let n1 = col1.storage.db_scalar::<u8>("select count() from notes")?;
            let n2 = col2.storage.db_scalar::<u8>("select count() from notes")?;
            assert_eq!(n1, n2, "note count must match across the round-trip");
            assert_eq!(n1, 2, "1 from upload_download + 1 added here");
            Ok(())
        })
        .await
    }

    // ---- T4: the 7b headline — 10 reviews on A + 10 different on B -> sync -> 20 land once ---------
    #[tokio::test]
    async fn t4_twenty_reviews_land_once() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client);

            // seed col1 with 20 cards, upload, download into col2 (both in sync, 0 revlog)
            let mut col1 = ctx.col1();
            seed_cards(&mut col1, 20);
            let out = ctx.normal_sync(&mut col1).await;
            assert!(matches!(
                out.required,
                SyncActionRequired::FullSyncRequired { .. }
            ));
            ctx.full_upload(col1).await;

            let mut col2 = ctx.col2();
            let out = ctx.normal_sync(&mut col2).await;
            assert_eq!(
                out.required,
                SyncActionRequired::FullSyncRequired {
                    upload_ok: false,
                    download_ok: true
                }
            );
            ctx.full_download(col2).await;

            // reopen; both sides now hold the same 20 cards
            let mut col1 = ctx.col1();
            let mut col2 = ctx.col2();
            let cards1 = col1.search_cards("", SortMode::NoOrder)?;
            let cards2 = col2.search_cards("", SortMode::NoOrder)?;
            assert_eq!(cards1.len(), 20);
            assert_eq!(
                cards2, cards1,
                "same card ids on both sides after the full sync"
            );

            // OFFLINE (no sync between): review 10 DISTINCT cards on col1, 10 OTHER cards on col2.
            // Explicit, strictly-increasing answer times => 20 distinct revlog ids (no clock collision).
            let base = TimestampMillis::now().0;
            for (i, &cid) in cards1[0..10].iter().enumerate() {
                review_card(&mut col1, cid, TimestampMillis(base + i as i64))?;
            }
            for (i, &cid) in cards2[10..20].iter().enumerate() {
                review_card(&mut col2, cid, TimestampMillis(base + 1_000 + i as i64))?;
            }

            // reconnect & sync: col1 push -> col2 push -> col1 pull-back
            ctx.normal_sync(&mut col1).await;
            ctx.normal_sync(&mut col2).await;
            ctx.normal_sync(&mut col1).await;

            // all 20 reviews on BOTH sides: none lost, none double-counted
            let ids1 = sorted_revlog_ids(&col1)?;
            let ids2 = sorted_revlog_ids(&col2)?;
            assert_eq!(ids1.len(), 20, "col1 must hold exactly 20 reviews");
            assert_eq!(ids2.len(), 20, "col2 must hold exactly 20 reviews");
            assert_eq!(
                ids1, ids2,
                "both collections converge to the same 20 reviews"
            );
            assert_eq!(
                ids1.iter().collect::<HashSet<_>>().len(),
                20,
                "no review id appears twice"
            );
            Ok(())
        })
        .await
    }

    // ---- S1: same object edited offline on both -> LWW-by-mtime (later mtime wins) -----------------
    #[tokio::test]
    async fn s1_conflict_lww_by_mtime() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client);

            // in-sync state with a shared note (capture its id at creation)
            let mut col1 = ctx.col1();
            let nt = col1.get_notetype_by_name("Basic").unwrap().unwrap();
            let mut note = nt.new_note();
            note.set_field(0, "front")?;
            note.set_field(1, "original")?;
            col1.add_note(&mut note, DeckId(1))?;
            let nid = note.id;
            let out = ctx.normal_sync(&mut col1).await;
            assert!(matches!(
                out.required,
                SyncActionRequired::FullSyncRequired { .. }
            ));
            ctx.full_upload(col1).await;
            let mut col2 = ctx.col2();
            let _ = ctx.normal_sync(&mut col2).await;
            ctx.full_download(col2).await;

            // OFFLINE edits to the SAME note on both; col2 edits LATER (strictly-greater mtime)
            let mut col1 = ctx.col1();
            let mut n1 = col1.storage.get_note(nid)?.unwrap();
            n1.set_field(1, "col1-edit")?;
            col1.update_note(&mut n1)?;

            // note mtime is seconds-granularity, so sleep past a 1s boundary to make col2's edit
            // strictly newer (the LWW comparison is `existing.mtime < entry.mtime`, chunks.rs)
            std::thread::sleep(std::time::Duration::from_millis(1100));

            let mut col2 = ctx.col2();
            let mut n2 = col2.storage.get_note(nid)?.unwrap();
            n2.set_field(1, "col2-edit")?;
            col2.update_note(&mut n2)?;

            // sync: col1 push (older) -> col2 push (newer) -> col1 pull-back
            ctx.normal_sync(&mut col1).await;
            ctx.normal_sync(&mut col2).await;
            ctx.normal_sync(&mut col1).await;

            // LWW by mtime: the LATER edit (col2) is the clear winner on BOTH sides
            let v1 = col1.storage.get_note(nid)?.unwrap().fields()[1].clone();
            let v2 = col2.storage.get_note(nid)?.unwrap().fields()[1].clone();
            assert_eq!(v2, "col2-edit", "the later writer's value persists on col2");
            assert_eq!(
                v1, "col2-edit",
                "and propagates to col1 — last-write-wins by mtime"
            );
            Ok(())
        })
        .await
    }

    // ---- C7: offline review then reconnect -> the offline reviews land ----------------------------
    #[tokio::test]
    async fn c7_offline_review_then_reconnect() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client);
            let mut col1 = ctx.col1();
            seed_cards(&mut col1, 3);
            let _ = ctx.normal_sync(&mut col1).await;
            ctx.full_upload(col1).await;
            let mut col2 = ctx.col2();
            let _ = ctx.normal_sync(&mut col2).await;
            ctx.full_download(col2).await;

            // "airplane mode": review on col1 with NO sync (the engine-level half of C7; the on-device
            // airplane-mode recording is the HUMAN half).
            let mut col1 = ctx.col1();
            let cards = col1.search_cards("", SortMode::NoOrder)?;
            let base = TimestampMillis::now().0;
            for (i, &cid) in cards.iter().enumerate() {
                review_card(&mut col1, cid, TimestampMillis(base + i as i64))?;
            }
            assert_eq!(revlog_count(&col1)?, 3);
            let mut col2 = ctx.col2();
            assert_eq!(
                revlog_count(&col2)?,
                0,
                "col2 hasn't seen the offline reviews yet"
            );

            // reconnect: the offline reviews land on the other device (reuse the same handles —
            // a second open handle to the same .anki2 file would hit a SQLite lock)
            ctx.normal_sync(&mut col1).await;
            ctx.normal_sync(&mut col2).await;
            assert_eq!(
                revlog_count(&col2)?,
                3,
                "offline reviews appear on col2 after reconnect"
            );
            Ok(())
        })
        .await
    }

    // ---- S2b: interrupted sync + replay -> no corruption, no loss, no double-count ----------------
    #[tokio::test]
    async fn s2b_midsync_interrupt_is_clean() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client.clone());

            // in-sync with 5 cards
            let mut col1 = ctx.col1();
            seed_cards(&mut col1, 5);
            let _ = ctx.normal_sync(&mut col1).await;
            ctx.full_upload(col1).await;
            let mut col2 = ctx.col2();
            let _ = ctx.normal_sync(&mut col2).await;
            ctx.full_download(col2).await;

            // review 5 cards on col1 (offline)
            let mut col1 = ctx.col1();
            let cards = col1.search_cards("", SortMode::NoOrder)?;
            let base = TimestampMillis::now().0;
            for (i, &cid) in cards.iter().enumerate() {
                review_card(&mut col1, cid, TimestampMillis(base + i as i64))?;
            }

            // INTERRUPTED sync: a session is started, then the connection drops (abort) before finish.
            let start_req = StartRequest {
                client_usn: Default::default(),
                local_is_newer: false,
                deprecated_client_graves: None,
            }
            .try_into_sync_request()?;
            client.start(start_req).await?;
            client.abort(EmptyInput::request()).await?;

            // reconnect: a clean normal sync pushes ALL 5 reviews exactly once
            let out = ctx.normal_sync(&mut col1).await;
            assert_eq!(out.required, SyncActionRequired::NoChanges);
            let mut col2 = ctx.col2();
            let _ = ctx.normal_sync(&mut col2).await;
            assert_eq!(
                revlog_count(&col1)?,
                5,
                "all offline reviews land after the interrupted attempt"
            );
            assert_eq!(
                revlog_count(&col2)?,
                5,
                "and propagate to col2 — none lost, none doubled"
            );

            // REPLAY: a redundant re-sync (as after a flaky reconnect) adds nothing — idempotent.
            let out = ctx.normal_sync(&mut col1).await;
            assert_eq!(out.required, SyncActionRequired::NoChanges);
            assert_eq!(revlog_count(&col1)?, 5, "re-sync must not double-count");
            Ok(())
        })
        .await
    }

    // ---- S2c: wrong-clock — two devices stamp DIFFERENT reviews with the SAME id ------------------
    // HONEST LIMITATION (documented in CONFLICT-RULE.md): because the RevlogId IS a wall-clock ms and
    // the merge does not uniquify, a TRUE cross-device id collision resolves to EXACTLY ONE surviving
    // row. We do NOT claim both reviews land; we assert the deterministic single-survivor outcome.
    #[tokio::test]
    async fn s2c_wrong_clock_revlog_id_collision() -> Result<()> {
        with_active_server(|client| async move {
            let ctx = SyncTestContext::new(client);

            // two in-sync collections, each with cards, 0 revlog
            let mut col1 = ctx.col1();
            seed_cards(&mut col1, 2);
            let _ = ctx.normal_sync(&mut col1).await;
            ctx.full_upload(col1).await;
            let mut col2 = ctx.col2();
            let _ = ctx.normal_sync(&mut col2).await;
            ctx.full_download(col2).await;

            let mut col1 = ctx.col1();
            let mut col2 = ctx.col2();
            let cards1 = col1.search_cards("", SortMode::NoOrder)?;
            let cards2 = col2.search_cards("", SortMode::NoOrder)?;

            // CLOCK SKEW: both devices stamp two DIFFERENT reviews with the SAME ms id.
            let collision = TimestampMillis(TimestampMillis::now().0);
            review_card(&mut col1, cards1[0], collision)?; // col1 reviews card A @ id=X
            review_card(&mut col2, cards2[1], collision)?; // col2 reviews card B @ id=X (same id!)

            ctx.normal_sync(&mut col1).await;
            ctx.normal_sync(&mut col2).await;
            ctx.normal_sync(&mut col1).await;

            // the colliding id resolves to exactly ONE row on each side (one review is shadowed)
            assert_eq!(
                revlog_count(&col1)?,
                1,
                "colliding revlog id => exactly one row on col1"
            );
            assert_eq!(
                revlog_count(&col2)?,
                1,
                "colliding revlog id => exactly one row on col2"
            );
            assert_eq!(sorted_revlog_ids(&col1)?, vec![collision.0]);
            Ok(())
        })
        .await
    }
}
