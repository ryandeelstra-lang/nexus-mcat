// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! charged_up: read-only per-topic (true-deck) mastery aggregation.
//!
//! Powers the dashboard's three honest scores and the knowledge-graph node
//! state. Read-only: it issues no writes of its own — the only sanctioned
//! config delta on its path is Anki's pre-existing `{rollover, localOffset}`
//! timing self-heal, which we move to collection OPEN (see
//! `backend/collection.rs`) so the first call here writes nothing.

use std::collections::HashMap;

use anki_proto::stats::mastery_query_response::Topic;
use anki_proto::stats::MasteryQueryRequest;
use anki_proto::stats::MasteryQueryResponse;
use fsrs::FSRS;
use fsrs::FSRS6_DEFAULT_DECAY;

use crate::prelude::*;
use crate::scheduler::fsrs::memory_state::get_decay_from_params;
use crate::search::SortMode;

/// Default retrievability above which a card counts as "mastered".
const DEFAULT_MASTERY_THRESHOLD: f32 = 0.9;

#[derive(Default)]
struct DeckAcc {
    total_cards: u32,
    cards_with_state: u32,
    mastered_count: u32,
    recall_sum: f32,
    reviewed_card_count: u32,
    stability_sum: f32,
}

impl Collection {
    /// Read-only per-true-deck mastery aggregation. No transact, no schema bump
    /// — the only config write on this path is Anki's `{rollover,
    /// localOffset}` self-heal, pre-warmed at open.
    pub fn mastery_query(&mut self, input: MasteryQueryRequest) -> Result<MasteryQueryResponse> {
        let threshold = if input.mastered_retrievability_threshold > 0.0 {
            input.mastered_retrievability_threshold
        } else {
            DEFAULT_MASTERY_THRESHOLD
        };
        // Pre-warmed at collection open; this is a cache hit and writes nothing.
        let now = self.timing_today()?.now;
        let fsrs = FSRS::new(None).unwrap();

        // Read the searched cards + their graded-review counts within ONE search_cids
        // scope (the temp table is cleared when the guard drops).
        let (cards, graded): (Vec<Card>, HashMap<DeckId, u32>) = {
            let guard = self.search_cards_into_table(input.search.as_str(), SortMode::NoOrder)?;
            let cards = guard.col.storage.all_searched_cards()?;
            let graded = guard
                .col
                .storage
                .mastery_graded_reviews_by_deck()?
                .into_iter()
                .collect();
            (cards, graded)
        };

        // Accumulate per TRUE deck (filtered-deck cards bucket under their original
        // deck).
        let mut by_deck: HashMap<DeckId, DeckAcc> = HashMap::new();
        for card in &cards {
            let true_deck = if card.original_deck_id == DeckId(0) {
                card.deck_id
            } else {
                card.original_deck_id
            };
            let acc = by_deck.entry(true_deck).or_default();
            acc.total_cards += 1;
            if card.reps > 0 {
                acc.reviewed_card_count += 1;
            }
            if let Some(state) = card.memory_state {
                let elapsed = card
                    .last_review_time
                    .map(|t| now.elapsed_secs_since(t) as u32)
                    .unwrap_or_default();
                let decay = card.decay.unwrap_or(FSRS6_DEFAULT_DECAY);
                let r = fsrs.current_retrievability_seconds(state.into(), elapsed, decay);
                acc.cards_with_state += 1;
                acc.recall_sum += r;
                acc.stability_sum += state.stability;
                if r >= threshold {
                    acc.mastered_count += 1;
                }
            }
        }

        // Resolve each topic's display name + per-user FSRS-6 decay (read-only
        // deck/config reads).
        let mut topics = Vec::with_capacity(by_deck.len());
        for (deck_id, acc) in by_deck {
            let (deck_name, decay) = match self.storage.get_deck(deck_id)? {
                Some(deck) => {
                    let decay = match deck.config_id() {
                        Some(cid) => match self.storage.get_deck_config(cid)? {
                            Some(cfg) => get_decay_from_params(cfg.fsrs_params()),
                            None => FSRS6_DEFAULT_DECAY,
                        },
                        None => FSRS6_DEFAULT_DECAY,
                    };
                    (deck.human_name(), decay)
                }
                None => (format!("[deleted deck {}]", deck_id.0), FSRS6_DEFAULT_DECAY),
            };
            let average_recall = if acc.cards_with_state > 0 {
                acc.recall_sum / acc.cards_with_state as f32
            } else {
                0.0
            };
            topics.push(Topic {
                deck_id: deck_id.0,
                deck_name,
                total_cards: acc.total_cards,
                cards_with_state: acc.cards_with_state,
                mastered_count: acc.mastered_count,
                average_recall,
                reviewed_card_count: acc.reviewed_card_count,
                graded_reviews: graded.get(&deck_id).copied().unwrap_or(0),
                stability_sum: acc.stability_sum,
                decay,
            });
        }
        // Deterministic order so the read-only equivalence test sees a stable response.
        topics.sort_by_key(|t| t.deck_id);

        Ok(MasteryQueryResponse {
            topics,
            mastered_retrievability_threshold: threshold,
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::card::FsrsMemoryState;
    use crate::tests::DeckAdder;
    use crate::tests::NoteAdder;

    fn req(search: &str, threshold: f32) -> MasteryQueryRequest {
        MasteryQueryRequest {
            search: search.to_string(),
            mastered_retrievability_threshold: threshold,
        }
    }

    /// Force an FSRS memory state onto a card (deterministic, no FSRS config
    /// needed).
    fn set_state(
        col: &mut Collection,
        cid: CardId,
        stability: f32,
        difficulty: f32,
        decay: f32,
        elapsed_secs: i64,
    ) {
        let mut card = col.storage.get_card(cid).unwrap().unwrap();
        card.memory_state = Some(FsrsMemoryState {
            stability,
            difficulty,
        });
        card.decay = Some(decay);
        card.last_review_time = Some(TimestampSecs::now().adding_secs(-elapsed_secs));
        if card.reps == 0 {
            card.reps = 1;
        }
        col.storage.update_card(&card).unwrap();
    }

    fn first_card_of(col: &mut Collection, note_id: NoteId) -> CardId {
        col.storage.all_cards_of_note(note_id).unwrap()[0].id
    }

    /// A read-only fingerprint of the parts of the collection a mastery query
    /// must NOT touch: revlog row count, schema-mod time, every card's
    /// (id,mod,data), and the FULL config table (key,usn,mtime_secs,val —
    /// all four columns).
    fn snapshot(col: &mut Collection) -> (i64, i64, String, String) {
        let db = &col.storage.db;
        let revlog_count: i64 = db
            .query_row("SELECT count(*) FROM revlog", [], |r| r.get(0))
            .unwrap();
        let scm: i64 = db
            .query_row("SELECT scm FROM col", [], |r| r.get(0))
            .unwrap();
        let cards: String = db
            .prepare("SELECT id, mod, data FROM cards ORDER BY id")
            .unwrap()
            .query_map([], |r| {
                Ok(format!(
                    "{}:{}:{}",
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?
                ))
            })
            .unwrap()
            .map(|x| x.unwrap())
            .collect::<Vec<_>>()
            .join("|");
        let config: String = db
            .prepare("SELECT key, usn, mtime_secs, val FROM config ORDER BY key")
            .unwrap()
            .query_map([], |r| {
                Ok(format!(
                    "{}:{}:{}:{:?}",
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, Vec<u8>>(3)?
                ))
            })
            .unwrap()
            .map(|x| x.unwrap())
            .collect::<Vec<_>>()
            .join("|");
        (revlog_count, scm, cards, config)
    }

    fn topic(
        resp: &MasteryQueryResponse,
        deck_id: i64,
    ) -> &anki_proto::stats::mastery_query_response::Topic {
        resp.topics
            .iter()
            .find(|t| t.deck_id == deck_id)
            .unwrap_or_else(|| panic!("no topic for deck {deck_id} in {:?}", resp.topics))
    }

    #[test]
    fn mastery_query_groups_by_subdeck() -> Result<()> {
        let mut col = Collection::new();
        let cp = DeckAdder::new("MCAT::C-P").add(&mut col);
        let bb = DeckAdder::new("MCAT::B-B").add(&mut col);
        let nt = col.basic_notetype();
        let n1 = NoteAdder::new(&nt)
            .fields(&["a", "1"])
            .deck(cp.id)
            .add(&mut col);
        let n2 = NoteAdder::new(&nt)
            .fields(&["b", "2"])
            .deck(cp.id)
            .add(&mut col);
        let n3 = NoteAdder::new(&nt)
            .fields(&["c", "3"])
            .deck(bb.id)
            .add(&mut col);
        let (c1, c2, c3) = (
            first_card_of(&mut col, n1.id),
            first_card_of(&mut col, n2.id),
            first_card_of(&mut col, n3.id),
        );
        set_state(&mut col, c1, 1000.0, 5.0, 0.2, 60); // freshly reviewed, huge stability -> mastered
        set_state(&mut col, c2, 0.1, 5.0, 0.2, 8_640_000); // 100 days, tiny stability -> not mastered
        set_state(&mut col, c3, 1000.0, 5.0, 0.2, 60); // mastered

        let resp = col.mastery_query(req("", 0.9))?;
        let cp_t = topic(&resp, cp.id.0);
        assert_eq!(cp_t.total_cards, 2);
        assert_eq!(cp_t.cards_with_state, 2);
        assert_eq!(
            cp_t.mastered_count, 1,
            "only the high-retrievability card is mastered"
        );
        assert!(cp_t.deck_name.contains("C-P"));
        let bb_t = topic(&resp, bb.id.0);
        assert_eq!(bb_t.total_cards, 1);
        assert_eq!(bb_t.mastered_count, 1);
        Ok(())
    }

    #[test]
    fn mastery_query_threshold_controls_mastered() -> Result<()> {
        let mut col = Collection::new();
        let cp = DeckAdder::new("MCAT::C-P").add(&mut col);
        let nt = col.basic_notetype();
        let n = NoteAdder::new(&nt)
            .fields(&["q", "a"])
            .deck(cp.id)
            .add(&mut col);
        let cid = first_card_of(&mut col, n.id);
        set_state(&mut col, cid, 10.0, 5.0, 0.2, 447 * 86_400); // mid-range retrievability

        // Derive the card's ACTUAL retrievability from the query, then bracket it — a
        // card is mastered iff its retrievability >= the threshold.
        let r = topic(&col.mastery_query(req("", 0.5))?, cp.id.0).average_recall;
        assert!(
            r > 0.05 && r < 0.95,
            "retrievability should be mid-range, got {r}"
        );
        let below = col.mastery_query(req("", r - 0.05))?;
        let above = col.mastery_query(req("", r + 0.05))?;
        assert_eq!(
            topic(&below, cp.id.0).mastered_count,
            1,
            "r >= threshold below r"
        );
        assert_eq!(
            topic(&above, cp.id.0).mastered_count,
            0,
            "r < threshold above r"
        );
        Ok(())
    }

    #[test]
    fn mastery_query_excludes_cards_without_state() -> Result<()> {
        let mut col = Collection::new();
        let cp = DeckAdder::new("MCAT::C-P").add(&mut col);
        let nt = col.basic_notetype();
        NoteAdder::new(&nt)
            .fields(&["new", "card"])
            .deck(cp.id)
            .add(&mut col);

        let resp = col.mastery_query(req("", 0.9))?;
        let t = topic(&resp, cp.id.0);
        assert_eq!(t.total_cards, 1);
        assert_eq!(t.cards_with_state, 0, "a New card has no FSRS state");
        assert_eq!(t.mastered_count, 0);
        assert_eq!(t.average_recall, 0.0);
        Ok(())
    }

    #[test]
    fn mastery_query_is_read_only() -> Result<()> {
        let mut col = Collection::new();
        let cp = DeckAdder::new("MCAT::C-P").add(&mut col);
        let nt = col.basic_notetype();
        let n = NoteAdder::new(&nt)
            .fields(&["q", "a"])
            .deck(cp.id)
            .add(&mut col);
        let cid = first_card_of(&mut col, n.id);
        set_state(&mut col, cid, 50.0, 5.0, 0.2, 86_400);

        // Pre-warm timing so the one-time {rollover, localOffset} self-heal is
        // attributed to OPEN, not to the query (mirrors backend/collection.rs).
        col.timing_today()?;
        let before = snapshot(&mut col);
        let _ = col.mastery_query(req("", 0.9))?; // empty search
        let _ = col.mastery_query(req("deck:MCAT::C-P", 0.9))?; // non-empty search
        let after = snapshot(&mut col);
        assert_eq!(
            before, after,
            "mastery_query must not write to the collection"
        );
        Ok(())
    }

    #[test]
    fn test_answer_then_undo_restores() -> Result<()> {
        // The 7a "undo still works + collection doesn't corrupt" characterization test.
        // Pins the FORKED engine's pre-existing undo (not mastery_query itself).
        let mut col = Collection::new();
        if col.timing_today()?.near_cutoff() {
            return Ok(());
        }
        let nt = col.basic_notetype();
        NoteAdder::new(&nt).fields(&["q", "a"]).add(&mut col); // Default deck
        let cid = col.get_first_card().id;
        let before = col.storage.get_card(cid)?.unwrap();
        let revlog_before: i64 =
            col.storage
                .db
                .query_row("SELECT count(*) FROM revlog", [], |r| r.get(0))?;

        col.answer_good();
        let revlog_after: i64 =
            col.storage
                .db
                .query_row("SELECT count(*) FROM revlog", [], |r| r.get(0))?;
        assert_eq!(
            revlog_after,
            revlog_before + 1,
            "answering writes one revlog row"
        );
        let answered = col.storage.get_card(cid)?.unwrap();
        assert_ne!(answered.reps, before.reps, "answering changed the card");

        col.undo()?;
        let restored = col.storage.get_card(cid)?.unwrap();
        assert_eq!(restored.queue, before.queue);
        assert_eq!(restored.ctype, before.ctype);
        assert_eq!(restored.due, before.due);
        assert_eq!(restored.reps, before.reps);
        assert_eq!(restored.interval, before.interval);
        assert_eq!(restored.memory_state, before.memory_state);
        let revlog_final: i64 =
            col.storage
                .db
                .query_row("SELECT count(*) FROM revlog", [], |r| r.get(0))?;
        assert_eq!(revlog_final, revlog_before, "undo removed the revlog row");
        Ok(())
    }

    #[test]
    fn mastery_query_counts_graded_reviews_and_real_decay() -> Result<()> {
        let mut col = Collection::new();
        let nt = col.basic_notetype();
        // Default deck (DeckId 1) so the new card lands in the study queue for
        // answer_good().
        let n = NoteAdder::new(&nt).fields(&["q", "a"]).add(&mut col);
        let cid = first_card_of(&mut col, n.id);

        // Answer the SAME card 3 times -> 3 graded revlog rows, 1 distinct reviewed
        // card.
        col.answer_good();
        col.storage.db.execute_batch("UPDATE cards SET due = 0")?;
        col.clear_study_queues();
        col.answer_good();
        col.storage.db.execute_batch("UPDATE cards SET due = 0")?;
        col.clear_study_queues();
        col.answer_good();

        // Give it an explicit memory state so cards_with_state / stability_sum are
        // exercised.
        set_state(&mut col, cid, 42.0, 5.0, 0.2, 86_400);

        let resp = col.mastery_query(req("", 0.0))?;
        let t = topic(&resp, 1);
        assert_eq!(t.graded_reviews, 3, "3 answer events");
        assert_eq!(t.reviewed_card_count, 1, "1 distinct reviewed card");
        assert_eq!(t.cards_with_state, 1);
        assert!((t.stability_sum - 42.0).abs() < 1e-3);
        // Per-topic decay comes from the preset's FSRS params (FSRS-6 default 0.1542
        // when unseeded) — never the FSRS-5 0.5 literal.
        assert!(t.decay > 0.0);
        assert!(
            (t.decay - 0.5).abs() > 1e-6,
            "decay must not be the FSRS-5 0.5 constant"
        );
        Ok(())
    }
}
