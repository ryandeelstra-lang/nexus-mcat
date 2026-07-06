# Copyright: Ankitects Pty Ltd and contributors
# License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

"""The voice-flashcard orchestrator (doc 24 §10) — the Keeper's spoken quiz, server-side.

The loop, made honest (§5):

  * The Keeper speaks a due card **worded as a question** — the card's authored ``SpokenPrompt``
    variant when present, then the shipped variants corpus (spec ruling 5 — authored content at
    serve time, AI-OFF-safe), then the card's own front. A reworded variant means a pass on it
    **blooms** the plant (``is_fresh_variant``).
  * The student answers by voice (transcribed by ``ai.stt``, out-of-process) or by typing.
  * The **server** re-derives the reference answer from the note, grades with ``ai.grade`` (never
    trusting a client "I was right"), maps the bucket → a real Anki rating, and applies the review
    **through the scheduler** (``diagnostic_session`` pattern) so FSRS/MasteryQuery light honestly.
  * Currency is the CLIENT's ledger (the garden store, spec ruling 4) — this module only returns
    the bucket; it credits nothing.

Hardening (spec §5): grading is bound to the card ``next_card`` served (anti-replay/farming), the
ask-again attempt counter lives server-side, and a failed ``answerCard`` reports ``applied: False``
with nothing logged — never a silent success.

This module MAY import the engine and the ``ai`` package (it is the seam between them). The ``ai``
package itself never imports the engine (its own wall).
"""

from __future__ import annotations

import hashlib
import html
import json
import re
from dataclasses import dataclass
from pathlib import Path

from ai import grade as ai_grade
from anki.cards import CardId
from anki.collection import Collection
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

# The bucket → Anki rating map (§3), stated once. ASK_AGAIN has no rating on attempt 1 (re-ask).
_RATING_BY_BUCKET = {
    ai_grade.BUCKET_GOOD: RATING_GOOD,
    ai_grade.BUCKET_OKAY: RATING_HARD,
    ai_grade.BUCKET_DONT_KNOW: RATING_AGAIN,
}

# Fast + near-perfect promotes GOOD→EASY (loop #9 "golden-hour glint", §14).
GLINT_MS = 6000

# repo_root/journey/voice_review.py -> repo_root/ai/corpus/variants
_VARIANTS_DIR = Path(__file__).resolve().parents[1] / "ai" / "corpus" / "variants"
_variants_cache: dict[tuple[str, str], dict[str, str]] | None = None


@dataclass
class _ServedCard:
    """Server-side session state: the one card grading is currently allowed for."""

    card_id: int
    attempt: int  # 1 on serve; 2 after an ask-again re-prompt
    # True once the reference answer was revealed to the client (the Keeper speaks it while
    # the grade is still in flight). A revealed serve forfeits the ask-again second attempt —
    # otherwise the player could hear the answer, get a re-prompt, and parrot it back as a
    # "recovered" pass.
    revealed: bool = False


_served: _ServedCard | None = None


def _reset_session() -> None:
    """Test/reload helper — forget the served card."""
    global _served
    _served = None


def _node_id(col: Collection, card_id: int) -> str:
    return col.decks.name(col.get_card(CardId(card_id)).did)


def _plain(text: str) -> str:
    """Card field HTML → a readable plain-text line (strip tags, unescape entities, collapse ws).

    Kept local (not the engine's ``html_to_text_line``) so grading has no dependency on the i18n
    global — the reference answer is derived deterministically server-side either way."""
    stripped = _TAG.sub(" ", text or "")
    return _WS.sub(" ", html.unescape(stripped)).strip()


def _front_hash(front_html: str) -> str:
    """Stable variants join key: normalized plain front text -> short sha256."""
    normalized = " ".join(_plain(front_html).lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def load_variants() -> dict[tuple[str, str], dict[str, str]]:
    """The authored reworded-prompt corpus, indexed by (deck_path, front_hash). Cached."""
    global _variants_cache
    if _variants_cache is not None:
        return _variants_cache
    index: dict[tuple[str, str], dict[str, str]] = {}
    if _VARIANTS_DIR.is_dir():
        for path in sorted(_VARIANTS_DIR.glob("*.jsonl")):
            try:
                for line in path.read_text(encoding="utf-8").splitlines():
                    if not line.strip():
                        continue
                    row = json.loads(line)
                    prompt = (row.get("spoken_prompt") or "").strip()
                    if prompt and row.get("deck_path") and row.get("front_hash"):
                        index[(row["deck_path"], row["front_hash"])] = row
            except Exception:
                continue  # a bad corpus file never breaks the review loop
    _variants_cache = index
    return index


# Conversational openers for a PLAIN card front (dialogue-UX rework 2026-07-03): the Keeper
# phrases every ask like a person talking, without inventing content — a deterministic opener
# (stable per card, so a re-ask reads the same) glued before the card's own question. Authored
# variants/SpokenPrompt lines are already tutor-voiced and stay verbatim. The opener is
# presentation only: it never marks a card as a reworded variant (bloom integrity).
_ASK_OPENERS = (
    "Tell me —",
    "Here's one:",
    "Let me ask you this:",
    "Alright, try this one:",
    "Now then —",
)


def _ask_opener(front_hash: str) -> str:
    return _ASK_OPENERS[int(front_hash[:8], 16) % len(_ASK_OPENERS)]


def keeper_line(note, node_id: str) -> tuple[str, bool]:  # type: ignore[no-untyped-def]
    """The line the Keeper speaks + whether it is a reworded variant (paraphrase gate).

    Order: the authored ``SpokenPrompt`` note field (future-proof), then the shipped variants
    corpus (spec ruling 5 — authored content at serve time, AI-OFF-safe), then the card's own
    front wrapped in a conversational opener (real free recall; grows but never blooms).
    """
    try:
        keys = note.keys()
    except Exception:
        keys = []
    if SPOKEN_PROMPT_FIELD in keys and _plain(note[SPOKEN_PROMPT_FIELD]):
        return _plain(note[SPOKEN_PROMPT_FIELD]), True
    fields = note.fields
    front = fields[0] if fields else ""
    fh = _front_hash(front)
    row = load_variants().get((node_id, fh))
    if row:
        return row["spoken_prompt"], True
    plain = _plain(front)
    if not plain:
        return plain, False
    return f"{_ask_opener(fh)} {plain}", False


def reference_answer(note) -> str:  # type: ignore[no-untyped-def]
    """The server-side reference answer (never sent to the client before the student speaks)."""
    fields = note.fields
    return _plain(fields[1]) if len(fields) > 1 else ""


def _reference_hash(reference: str) -> str:
    return hashlib.sha256(reference.encode("utf-8")).hexdigest()[:16]


def next_card(
    col: Collection, *, prefer_variant: bool = False
) -> dict[str, object] | None:
    """The next due card as a Keeper prompt. Returns None when nothing is due.

    The reference answer is NOT included — the client must not hold the answer before speaking.
    ``prefer_variant=True`` scans the front of the queue for a card with a reworded variant (the
    bloom beat needs one); when none exists in the scan window we return the honest
    ``{"no_variant": True}`` marker instead of pretending.
    """
    global _served
    fetch = 20 if prefer_variant else 1
    # the v3 scheduler is the only one shipped/enabled in this fork; assert for the type-checker
    queued = col.sched.get_queued_cards(fetch_limit=fetch)  # type: ignore[union-attr]
    if not queued.cards:
        return None
    chosen = None
    if prefer_variant:
        for qc in queued.cards:
            cid = int(qc.card.id)
            note = col.get_card(CardId(cid)).note()
            _line, is_variant = keeper_line(note, _node_id(col, cid))
            if is_variant:
                chosen = qc
                break
        if chosen is None:
            return {"no_variant": True}
    else:
        chosen = queued.cards[0]
    card_id = int(chosen.card.id)
    note = col.get_card(CardId(card_id)).note()
    node_id = _node_id(col, card_id)
    line, is_variant = keeper_line(note, node_id)
    _served = _ServedCard(card_id=card_id, attempt=1)
    return {
        "card_id": card_id,
        "node_id": node_id,
        "keeper_line": line,
        "is_fresh_variant": is_variant,
        "counts": {
            "new": queued.new_count,
            "learning": queued.learning_count,
            "review": queued.review_count,
        },
    }


def reveal_answer(col: Collection, *, card_id: int) -> dict[str, object]:
    """The reference answer for the CURRENTLY SERVED card, for the Keeper to speak while the
    grade is still in flight (no dead air during the LLM/STT round-trip).

    Bound to the serve like grading is (replays/other cards rejected). Revealing marks the
    serve: the ask-again ladder is forfeited for a revealed serve (see ``grade_answer``), so
    hearing the answer early can never be converted into a second-attempt recovery. The honest
    client only calls this at submit time, together with the grade request.
    """
    if _served is None or _served.card_id != card_id:
        return {"error": "not_served", "revealed": False}
    _served.revealed = True
    note = col.get_card(CardId(card_id)).note()
    return {"revealed": True, "correct_answer": reference_answer(note)}


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
    idk: bool = False,
    ms_taken: int | None = None,
    stt_provider: str | None = None,
    stt_model: str | None = None,
) -> dict[str, object]:
    """Grade one spoken/typed answer end-to-end, server-side (the §10 contract).

    Correctness is re-derived here from the note — the client never decides it. Grading is bound
    to the card ``next_card`` served (one terminal grade per serve; replays rejected). On
    ASK_AGAIN at the server-tracked attempt 1 the card is NOT answered; a re-prompt is returned.
    Otherwise the review is applied through the scheduler and logged — or, if the scheduler apply
    fails, nothing is logged and ``applied: False`` is reported honestly.
    """
    global _served
    if _served is None or _served.card_id != card_id:
        return {"error": "not_served", "applied": False}
    attempt = _served.attempt

    card = col.get_card(CardId(card_id))
    note = card.note()
    node_id = col.decks.name(card.did)
    line, is_variant = keeper_line(note, node_id)
    reference = reference_answer(note)

    g = ai_grade.grade_spoken(line, reference, transcript, idk=idk)

    # Ask-again ladder (§13): first partial answer earns a second chance, no commit yet. The
    # attempt counter is SERVER state — the client cannot reset it.
    if g.bucket == ai_grade.BUCKET_ASK_AGAIN and attempt == 1 and not _served.revealed:
        _served.attempt = 2
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
    if revlog_id is None:
        # Honest failure (spec §5.3): no grade row, no reward, never a silent success.
        _served = None
        return {"error": "apply_failed", "applied": False}

    sidecar.record_audio_grade(
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

    # Bloom = a passed reworded variant (§14) — reuses the existing paraphrase predicate.
    bloomed = is_variant and effective_bucket in (
        ai_grade.BUCKET_GOOD,
        ai_grade.BUCKET_OKAY,
    )
    recovered = attempt == 2 and effective_bucket in (
        ai_grade.BUCKET_GOOD,
        ai_grade.BUCKET_OKAY,
    )

    _served = None  # one terminal grade per serve — replays are rejected

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
        "recovered": recovered,
        "bloomed": bloomed,
        "is_fresh_variant": is_variant,
        "applied": True,
    }
