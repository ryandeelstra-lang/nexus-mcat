# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""The voice-flashcard orchestrator (doc 24 §10) — the Keeper's spoken quiz, server-side.

The loop, made honest (§5):

  * The Keeper speaks a due card **worded as a question** — the card's authored ``SpokenPrompt``
    variant (the paraphrase gate, §14) when present, else the card's own front. A ``SpokenPrompt``
    variant is a *reworded* prompt, so a pass on it **blooms** the plant (``is_fresh_variant``).
  * The student answers by voice (transcribed by ``ai.stt``, out-of-process) or by typing.
  * The **server** re-derives the reference answer from the note, grades with ``ai.grade`` (never
    trusting a client "I was right"), maps the bucket → a real Anki rating, and applies the review
    **through the scheduler** (``diagnostic_session`` pattern) so FSRS/MasteryQuery light honestly.
  * The reward is credited to the garden economy sidecar; currency is spendable, never mastery (§5).

The one honest number is the *measured* similarity %; on uncertainty we map DOWN (§3). "Ask again"
(40–69%) is a scaffolded second chance, not a terminal grade (§13): one re-ask per card per session,
terminal fallback AGAIN.

This module MAY import the engine and the ``ai`` package (it is the seam between them). The ``ai``
package itself never imports the engine (its own wall).
"""

from __future__ import annotations

import hashlib
import html
import re

from anki.cards import CardId
from anki.collection import Collection

from ai import grade as ai_grade
from scores.telemetry import sidecar

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

# v3 scheduler ease buttons (mirror diagnostic_session): a real graded review either way.
RATING_AGAIN = 1
RATING_HARD = 2
RATING_GOOD = 3
RATING_EASY = 4

# The authored reworded-prompt field on a seed note (doc 24 §14 / AF-7). Optional.
SPOKEN_PROMPT_FIELD = "SpokenPrompt"

# Reward table (doc 24 §3 — a balance knob, not an integrity rule).
REWARD_BY_BUCKET = {
    ai_grade.BUCKET_GOOD: 3,
    ai_grade.BUCKET_OKAY: 2,
    ai_grade.BUCKET_ASK_AGAIN: 1,
    ai_grade.BUCKET_DONT_KNOW: 1,  # showing up + retrieving still pays
}

# The bucket → Anki rating map (§3), stated once. ASK_AGAIN has no rating on attempt 1 (re-ask).
_RATING_BY_BUCKET = {
    ai_grade.BUCKET_GOOD: RATING_GOOD,
    ai_grade.BUCKET_OKAY: RATING_HARD,
    ai_grade.BUCKET_DONT_KNOW: RATING_AGAIN,
}

# Fast + near-perfect promotes GOOD→EASY (loop #9 "golden-hour glint", §14).
GLINT_MS = 6000


def _node_id(col: Collection, card_id: int) -> str:
    return col.decks.name(col.get_card(CardId(card_id)).did)


def _plain(text: str) -> str:
    """Card field HTML → a readable plain-text line (strip tags, unescape entities, collapse ws).

    Kept local (not the engine's ``html_to_text_line``) so grading has no dependency on the i18n
    global — the reference answer is derived deterministically server-side either way."""
    stripped = _TAG.sub(" ", text or "")
    return _WS.sub(" ", html.unescape(stripped)).strip()


def keeper_line(note) -> tuple[str, bool]:  # type: ignore[no-untyped-def]
    """The line the Keeper speaks + whether it is a reworded variant (paraphrase gate).

    Prefers the authored ``SpokenPrompt`` field (reworded → bloom-eligible); falls back to the
    card's own front (a real free-recall test that grows but doesn't count as a paraphrase-bloom).
    """
    try:
        keys = note.keys()
    except Exception:
        keys = []
    if SPOKEN_PROMPT_FIELD in keys and _plain(note[SPOKEN_PROMPT_FIELD]):
        return _plain(note[SPOKEN_PROMPT_FIELD]), True
    fields = note.fields
    return (_plain(fields[0]) if fields else ""), False


def reference_answer(note) -> str:  # type: ignore[no-untyped-def]
    """The server-side reference answer (never sent to the client before the student speaks)."""
    fields = note.fields
    return _plain(fields[1]) if len(fields) > 1 else ""


def _reference_hash(reference: str) -> str:
    return hashlib.sha256(reference.encode("utf-8")).hexdigest()[:16]


def next_card(col: Collection) -> dict[str, object] | None:
    """The next due card as a Keeper prompt. Returns None when nothing is due.

    The reference answer is NOT included — the client must not hold the answer before speaking.
    """
    # the v3 scheduler is the only one shipped/enabled in this fork; assert for the type-checker
    queued = col.sched.get_queued_cards(fetch_limit=1)  # type: ignore[union-attr]
    if not queued.cards:
        return None
    qc = queued.cards[0]
    card_id = int(qc.card.id)
    note = col.get_card(CardId(card_id)).note()
    line, is_variant = keeper_line(note)
    return {
        "card_id": card_id,
        "node_id": _node_id(col, card_id),
        "keeper_line": line,
        "is_fresh_variant": is_variant,
        "counts": {
            "new": queued.new_count,
            "learning": queued.learning_count,
            "review": queued.review_count,
        },
    }


def _apply_through_scheduler(col: Collection, card_id: int, rating: int) -> int | None:
    """Apply the review through the REAL scheduler (spoof-proof, lights FSRS/MasteryQuery)."""
    try:
        card = col.get_card(CardId(card_id))
        card.start_timer()
        col.sched.answerCard(card, rating)  # type: ignore[arg-type]
        return col.db.scalar("select max(id) from revlog")
    except Exception:
        return None


def _rating_for(bucket: str, score_0_100: float, ms_taken: int | None) -> int:
    rating = _RATING_BY_BUCKET.get(bucket, RATING_AGAIN)
    if (
        bucket == ai_grade.BUCKET_GOOD
        and score_0_100 >= ai_grade.EASY_CUTOFF * 100
        and ms_taken is not None
        and ms_taken <= GLINT_MS
    ):
        return RATING_EASY
    return rating


def grade_answer(
    col: Collection,
    *,
    card_id: int,
    transcript: str,
    currency: str,
    idk: bool = False,
    attempt: int = 1,
    ms_taken: int | None = None,
    stt_provider: str | None = None,
    stt_model: str | None = None,
) -> dict[str, object]:
    """Grade one spoken/typed answer end-to-end, server-side (the §10 contract).

    Correctness is re-derived here from the note — the client never decides it. On ASK_AGAIN at
    attempt 1 the card is NOT answered; a re-prompt is returned. Otherwise the review is applied
    through the scheduler, the grade is logged, and the reward is credited.
    """
    card = col.get_card(CardId(card_id))
    note = card.note()
    node_id = col.decks.name(card.did)
    line, is_variant = keeper_line(note)
    reference = reference_answer(note)

    g = ai_grade.grade_spoken(line, reference, transcript, idk=idk)

    # Ask-again ladder (§13): first partial answer earns a reworded second chance, no commit yet.
    if g.bucket == ai_grade.BUCKET_ASK_AGAIN and attempt == 1:
        return {
            "bucket": g.bucket,
            "score": g.score_0_100,
            "method": g.method,
            "sentinel": g.sentinel,
            "transcript": transcript,
            "rationale": g.rationale,
            "re_prompt": {
                "keeper_line": line,
                "hint": "Let's try that another way — what's the core idea?",
                "attempt": 2,
            },
            "applied": False,
        }

    # Terminal: ASK_AGAIN that survived to attempt 2 falls back to AGAIN (§13).
    effective_bucket = g.bucket
    if g.bucket == ai_grade.BUCKET_ASK_AGAIN:
        effective_bucket = ai_grade.BUCKET_DONT_KNOW

    rating = _rating_for(effective_bucket, g.score_0_100, ms_taken)
    revlog_id = _apply_through_scheduler(col, card_id, rating)

    grade_id = sidecar.record_audio_grade(
        col,
        node_id=node_id,
        card_id=card_id,
        transcript=transcript,
        score=g.score_0_100,
        bucket=effective_bucket,
        method=g.method,
        rating=rating,
        revlog_id=revlog_id,
        reference_hash=_reference_hash(reference),
        is_fresh_variant=is_variant,
        stt_provider=stt_provider,
        stt_model=stt_model,
        grade_source_id=g.source_id,
    )

    reward = REWARD_BY_BUCKET.get(effective_bucket, 1)
    balance = sidecar.credit_currency(
        col,
        currency=currency,
        delta=reward,
        reason=f"audio_grade:{effective_bucket}",
        audio_grade_id=grade_id,
    )

    # Bloom = a passed reworded variant (§14) — reuses the existing paraphrase predicate.
    bloomed = is_variant and effective_bucket in (
        ai_grade.BUCKET_GOOD,
        ai_grade.BUCKET_OKAY,
    )

    return {
        "bucket": effective_bucket,
        "score": g.score_0_100,
        "method": g.method,
        "sentinel": g.sentinel,
        "transcript": transcript,
        "correct_answer": reference,
        "key_points_hit": g.key_points_hit,
        "key_points_missed": g.key_points_missed,
        "rationale": g.rationale,
        "rating": rating,
        "reward": reward,
        "currency": currency,
        "balance": balance if balance is not None else 0,
        "bloomed": bloomed,
        "is_fresh_variant": is_variant,
        "applied": True,
    }
