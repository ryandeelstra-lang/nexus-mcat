# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""Order-agnostic simulated learner driving the REAL v3 scheduler (§8, T7).

The scheduler is never reimplemented: every card shown comes from the engine's
get_queued_cards under the arm's deck config, and every answer goes through
build_answer/answer_card, so queue building, FSRS memory updates, daily limits
and (re)learning steps are all the real engine. The learner never reads the
arm name — it sees only the served card sequence:

- recall of a seen card = the engine's own FSRS-6 forgetting curve
  (fsrs 5.2.0 inference.rs:60-63) on ENGINE-STORED stability/decay, at the
  simulated day-granular elapsed time (pinned against col.card_stats_data by
  tests/scores/test_ablation.py);
- discrimination between confusable topic pairs accrues only from consecutive
  presentations of the two pair members in the actually-served sequence;
- the confusability penalty applies only on the held-out mixed-topic quiz.

Determinism (README §6): note/card ids + mods are normalized to fixed
constants, answered_at is stamped at day-exact simulated times, interval fuzz
is off under ANKI_TEST_MODE=1, and every learner draw is a SHA-256 hash — so
a rerun with the same master seed is byte-identical.
"""

from __future__ import annotations

import os
import shutil
import tempfile
import time
from dataclasses import dataclass, field

from anki.collection import Collection
from anki.cards import Card
from anki.scheduler_pb2 import CardAnswer

from scores.engine import SYNTHETIC_MARKER, enable_fsrs

from scores.ablation import design


def _require_test_mode() -> None:
    # Without ANKI_TEST_MODE=1 the engine applies interval fuzz + load-balancer
    # RNG (rslib/src/scheduler/answering/mod.rs:662-668) and the run is neither
    # reproducible nor arm-comparable. Fail closed rather than drift silently.
    if os.environ.get("ANKI_TEST_MODE") != "1":
        raise RuntimeError(
            "the ablation must run with ANKI_TEST_MODE=1 (disables scheduler "
            "fuzz; required for the pre-registered deterministic design)"
        )


def _guard_rollover(col: Collection) -> None:
    # Timing uses the real clock for 'today'; near the 4 AM rollover (or inside
    # the 02:00-04:00 ANKI_TEST_MODE clock-shift window) a run could straddle a
    # day boundary mid-simulation. Abort cleanly instead (README §6).
    now = int(time.time())
    if col.sched.day_cutoff - now < 1800:
        raise RuntimeError(
            "within 30 minutes of the day rollover — rerun after the rollover"
        )
    hour_min = time.localtime(now).tm_hour * 60 + time.localtime(now).tm_min
    if 90 <= hour_min < 240:  # 01:30-04:00 local
        raise RuntimeError(
            "01:30-04:00 local is inside the ANKI_TEST_MODE clock-shift "
            "window — rerun outside it"
        )


def retrievability(stability: float, decay: float, elapsed_secs: float) -> float:
    """The engine's FSRS-6 forgetting curve (fsrs 5.2.0 inference.rs:60-63).

    factor = 0.9^(1/-decay) - 1;  r = (elapsed_days/S * factor + 1)^(-decay)
    """
    if stability <= 0.0:
        return 0.0
    factor = 0.9 ** (1.0 / -decay) - 1.0
    days = elapsed_secs / 86400.0
    return (days / stability * factor + 1.0) ** (-decay)


@dataclass
class StudyResult:
    """Arm-blind summary of one learner's study phase (all a quiz needs)."""

    arm: str
    learner: int
    days: int
    card_topic: dict[int, int] = field(default_factory=dict)
    k_by_topic: dict[int, float] = field(default_factory=dict)
    contrast_by_pair: dict[tuple[int, int], int] = field(default_factory=dict)
    presentations: int = 0
    study_correct: int = 0
    seconds_used: int = 0
    budget_capped_days: int = 0
    # (day, card id) per served presentation — diagnostics + determinism audit.
    sequence: list[tuple[int, int]] = field(default_factory=list)


def _apply_arm_config(col: Collection, arm: str) -> None:
    # Decision 4: flip ONLY review_order + new_card_gather_priority. PLAIN
    # keeps upstream defaults untouched. Order comes from the ROOT deck's
    # config; all decks here share the default preset, so one edit covers the
    # whole tree. Persist via decks.save() (the path gen_bench_deck.py uses).
    if arm == "PLAIN":
        return
    fields = design.arm_deck_config(arm)
    for conf in col.decks.all_config():
        conf["reviewOrder"] = fields["reviewOrder"]
        conf["newGatherPriority"] = fields["newGatherPriority"]
        col.decks.save(conf)


def _normalize_identity(col: Collection) -> None:
    # Note/card ids and mods are wall-clock-derived at creation, and the
    # engine's Random review order sorts by fnvhash(id, mod)
    # (rslib/src/storage/card/mod.rs:823). Renumber both to fixed constants so
    # queue shuffles are identical across arms and across reruns.
    nids = col.db.list("select id from notes order by id")
    for i, nid in enumerate(nids):
        new_nid = design.NOTE_ID_BASE_MS + i
        col.db.execute(
            "update notes set id=?, mod=? where id=?", new_nid, design.BASE_EPOCH_S, nid
        )
        col.db.execute("update cards set nid=? where nid=?", new_nid, nid)
    cids = col.db.list("select id from cards order by nid, ord")
    for i, cid in enumerate(cids):
        col.db.execute(
            "update cards set id=?, mod=? where id=?",
            design.CARD_ID_BASE_MS + i,
            design.BASE_EPOCH_S,
            cid,
        )


def build_template(arm: str, directory: str) -> str:
    """Build the deterministic per-arm collection fixture once; copies are
    cheap. Identical across learners — only the two Decision-4 config fields
    (and nothing else) differ between arms."""
    _require_test_mode()
    path = os.path.join(directory, f"ablation-{arm}.anki2")
    if os.path.exists(path):  # Collection() would otherwise open + append
        os.unlink(path)
    col = Collection(path)
    try:
        enable_fsrs(col)  # stock upstream option, held constant across arms
        col.set_config(SYNTHETIC_MARKER, True)  # honesty sentinel (never surfaced)
        model = col.models.by_name("Basic") or col.models.all()[0]
        col.models.set_current(model)
        for t in range(design.TOPICS):
            did = col.decks.id(f"MCAT::T{t:02d}")
            for i in range(design.CARDS_PER_TOPIC):
                note = col.new_note(model)
                note["Front"] = f"ablation-q-t{t:02d}-i{i:02d}"
                note["Back"] = f"ablation-a-t{t:02d}-i{i:02d}"
                col.add_note(note, did)
        _apply_arm_config(col, arm)
        col.decks.select(col.decks.id("MCAT"))  # queues draw from the MCAT tree
        _normalize_identity(col)
        n = col.db.scalar("select count() from cards")
        expected = design.TOPICS * design.CARDS_PER_TOPIC
        if n != expected:
            raise RuntimeError(f"fixture has {n} cards, expected {expected}")
    finally:
        col.close()
    return path


def card_topic_map() -> dict[int, int]:
    # After normalization, card ids are CARD_ID_BASE_MS + i with i in
    # topic-major creation order — the topic is a pure function of the id.
    return {
        design.CARD_ID_BASE_MS + i: i // design.CARDS_PER_TOPIC
        for i in range(design.TOPICS * design.CARDS_PER_TOPIC)
    }


def simulate_study(
    arm: str,
    seed: int,
    days: int = design.DAYS,
    budget_secs: int = design.BUDGET_SECS_PER_DAY,
    template: str | None = None,
) -> StudyResult:
    """Run one learner through `days` real-scheduler study days for one arm."""
    _require_test_mode()
    if arm not in design.ARMS:
        raise ValueError(f"unknown arm {arm!r}")
    tmpdir = tempfile.mkdtemp(prefix="ablation-run-")
    if template is None:
        template = build_template(arm, tmpdir)
    work = os.path.join(tmpdir, f"{arm}-{seed}.anki2")
    shutil.copy(template, work)

    res = StudyResult(arm=arm, learner=seed, days=days)
    res.card_topic = card_topic_map()
    reps: dict[int, int] = {}
    last_review_day: dict[int, int] = {}
    pair_set = set(design.PAIRS)

    col = Collection(work)
    try:
        crt0 = col.crt
        # The FSRS state update uses INTEGER days:
        # next_day_at.elapsed_days_since(last_review_time)
        # (rslib/src/scheduler/answering/mod.rs:480-487, timestamp.rs:31-33).
        # Stamping every answer one hour into the current sched day, then
        # AGING lrt/revlog by 86400 s at each day boundary, makes every
        # elapsed value an exact whole number of days — identical across
        # arms, run dates, and times of day (README §8 amendment).
        anchor_s = col.sched.day_cutoff - 86400
        for day in range(days):
            # Advance the simulated calendar: shift crt, then close+reopen —
            # without the reopen the cached scheduler timing silently corrupts
            # scheduling (probe-verified; README §6).
            col.crt = crt0 - day * 86400
            col.close()
            col = Collection(work)
            _guard_rollover(col)
            if col.sched.day_cutoff - 86400 != anchor_s:
                raise RuntimeError(
                    "day rollover moved mid-run — rerun the simulation"
                )

            stamp_ms = (anchor_s + 3600) * 1000
            used = 0
            served_today = 0
            prev_topic: int | None = None
            while True:
                queued = col.sched.get_queued_cards(fetch_limit=1)
                if not queued.cards:
                    break
                cost_if_fail = design.COST_FAILURE_SECS
                if used + cost_if_fail > budget_secs:
                    res.budget_capped_days += 1
                    break
                qc = queued.cards[0]
                # End the session instead of serving future-due learn-ahead
                # cards: the engine stamps intraday step dues at real-clock
                # second granularity, so their tie order is not reproducible.
                # Step timers roll overnight (dues re-normalized at day end)
                # — README §8 amendment, applied before the first artifact run.
                if qc.card.due > time.time():
                    break
                card = Card(col)
                card._load_from_backend_card(qc.card)
                card.start_timer()
                cid = card.id
                topic = res.card_topic[cid]
                rep = reps.get(cid, 0)

                state = card.memory_state
                if cid in last_review_day and state is not None and state.stability > 0 and card.decay:
                    elapsed_days = day - last_review_day[cid]
                    p_recall = retrievability(
                        state.stability, card.decay, elapsed_days * 86400
                    )
                else:
                    p_recall = design.P0_FIRST_EXPOSURE  # first exposure
                ok = design.u01(design.MASTER_SEED, "study", seed, cid, rep) < p_recall

                rating = CardAnswer.GOOD if ok else CardAnswer.AGAIN
                cost = design.COST_SUCCESS_SECS if ok else design.COST_FAILURE_SECS
                answer = col.sched.build_answer(card=card, states=qc.states, rating=rating)
                # Stamp inside the current sched day (+k ms for unique revlog
                # ids); the day-end aging pass pushes it one day back per
                # simulated day, so FSRS elapsed reads exact whole days.
                answer.answered_at_millis = stamp_ms + served_today
                answer.milliseconds_taken = cost * 1000
                col.sched.answer_card(answer)

                reps[cid] = rep + 1
                last_review_day[cid] = day
                used += cost
                served_today += 1
                res.presentations += 1
                res.study_correct += 1 if ok else 0
                res.sequence.append((day, cid))
                if prev_topic is not None and prev_topic != topic:
                    key = (min(prev_topic, topic), max(prev_topic, topic))
                    if key in pair_set:
                        res.contrast_by_pair[key] = res.contrast_by_pair.get(key, 0) + 1
                prev_topic = topic
            res.seconds_used += used
            # AGE THE COLLECTION BY ONE DAY (README §8 amendment):
            # 1. card mods -> fixed constant, so the next day's
            #    fnvhash(id, mod) review shuffle is reproducible;
            # 2. last_review_time (cards.data JSON 'lrt') back 86400 s, so
            #    the engine's integer-day FSRS elapsed matches the simulated
            #    calendar;
            # 3. revlog ids back 86400000 ms, so prior days never count as
            #    "studied today" against the daily limits;
            # 4. pending intraday (re)learning steps get deterministic,
            #    id-ordered overnight dues (served next morning).
            col.db.execute("update cards set mod = ?", design.BASE_EPOCH_S)
            col.db.execute(
                "update cards set data = json_set(data, '$.lrt',"
                " json_extract(data, '$.lrt') - 86400)"
                " where data like '%lrt%'"
            )
            col.db.execute("update revlog set id = id - 86400000")
            col.db.execute(
                "update cards set due = ? + (id - ?) where queue = 1",
                anchor_s - 86400,
                design.CARD_ID_BASE_MS,
            )

        # Topic knowledge at quiz time (the morning after the last study day),
        # from engine-stored FSRS state via the pinned mirror curve at exact
        # whole-day elapsed.
        k_sum = {t: 0.0 for t in range(design.TOPICS)}
        for cid, topic in res.card_topic.items():
            if cid not in last_review_day:
                continue  # never studied -> contributes 0 knowledge
            card = col.get_card(cid)
            state = card.memory_state
            if state is not None and state.stability > 0 and card.decay:
                elapsed_days = days - last_review_day[cid]
                k_sum[topic] += retrievability(
                    state.stability, card.decay, elapsed_days * 86400
                )
        res.k_by_topic = {
            t: k_sum[t] / design.CARDS_PER_TOPIC for t in range(design.TOPICS)
        }
    finally:
        col.close()
    return res


def quiz_accuracy(study: StudyResult, confusability: float) -> float:
    """Held-out mixed-topic quiz (README §4): p = g + (1-g)·K_t·(1-κ·(1-D)).

    Arm-blind: reads only the study summary. Draws are common random numbers
    keyed by (learner, item) — identical across arms and sweep points.
    """
    items = design.quiz_items()
    correct = 0
    for item in items:
        pair = design.pair_of(item.topic)
        d = design.discrimination(study.contrast_by_pair.get(pair, 0))
        k = study.k_by_topic.get(item.topic, 0.0)
        p = design.GUESS_FLOOR + (1.0 - design.GUESS_FLOOR) * k * (
            1.0 - confusability * (1.0 - d)
        )
        if design.u01(design.MASTER_SEED, "quiz", study.learner, item.item_id) < p:
            correct += 1
    return correct / len(items)


def simulate(
    arm: str,
    seed: int,
    confusability: float,
    minutes: int | None = None,
    days: int = design.DAYS,
) -> float:
    """W3.7 interface: held-out quiz accuracy for one arm/seed. Same seed +
    same budget across arms — only the arm's two config fields differ."""
    budget = minutes * 60 if minutes is not None else design.BUDGET_SECS_PER_DAY
    study = simulate_study(arm, seed, days=days, budget_secs=budget)
    return quiz_accuracy(study, confusability)
