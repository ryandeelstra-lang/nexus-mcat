// charged_up: the Keeper's question panel — the REAL review loop, ported 1:1 to React
// from the retired Nexus-era StudyCard.svelte (Decision 43; docs/26 G1.4; doc 23 §21.2).
// getQueuedCards -> renderExistingCard -> reveal -> answerCard -> next; identical RPCs,
// identical args, the same sandboxed iframe. The garden adds ONLY presentation: cozy grade
// buttons ("Again" a soft rose, never a red buzzer), a growth-tick event per graded answer,
// and the pending-queue scoping the Keeper applies OUTSIDE this component (via
// setCurrentDeck) — FSRS owns every interval (I1).
import React, { useCallback, useEffect, useRef, useState } from "react";

import { CardAnswer_Rating } from "@generated/anki/scheduler_pb";
import type { QueuedCards_QueuedCard } from "@generated/anki/scheduler_pb";
import { answerCard, getQueuedCards, renderExistingCard } from "@generated/backend";

import { buildCardSrcdoc, nodesToHtml } from "./card-render";

type Phase = "loading" | "question" | "answer" | "empty" | "nocol";

export interface GradedEvent {
    rating: CardAnswer_Rating;
    msTaken: number;
    deckId: bigint;
}

export interface StudyCardProps {
    /** Fired after each graded answer lands in the engine (drives growth ticks + refills). */
    onGraded: (event: GradedEvent) => void;
    /** Fired when the queue for the current scope is exhausted. */
    onEmpty: (counts: { answered: number }) => void;
    /** Fired on close/back. */
    onClose: () => void;
    /** The Keeper's context line rendered above the card (e.g. the topic being tended). */
    contextLabel?: string;
    /** A one-shot key that forces a reload when the outer scope (deck) changes. */
    scopeKey: string;
}

/** One contract for "fast": MUST match the server's GLINT_MS (journey/voice_review.py) —
 * the gold glint fx and the GOOD→EASY promotion must agree on what a fast answer is. */
const FAST_ANSWER_MS = 6_000;

export function StudyCard(props: StudyCardProps): React.ReactElement {
    const { onGraded, onEmpty, onClose, contextLabel, scopeKey } = props;
    const [phase, setPhase] = useState<Phase>("loading");
    const [queued, setQueued] = useState<QueuedCards_QueuedCard | null>(null);
    const [counts, setCounts] = useState({ new: 0, learning: 0, review: 0 });
    const [srcdoc, setSrcdoc] = useState("");
    const html = useRef({ css: "", q: "", a: "" });
    const shownAt = useRef(0);
    const answered = useRef(0);
    const busy = useRef(false);

    const loadNext = useCallback(async (): Promise<void> => {
        setPhase("loading");
        try {
            const resp = await getQueuedCards(
                { fetchLimit: 1, intradayLearningOnly: false },
                { alertOnError: false },
            );
            setCounts({
                new: resp.newCount,
                learning: resp.learningCount,
                review: resp.reviewCount,
            });
            if (resp.cards.length === 0) {
                setQueued(null);
                setPhase("empty");
                onEmpty({ answered: answered.current });
                return;
            }
            const next = resp.cards[0];
            setQueued(next);
            const rendered = await renderExistingCard(
                { cardId: next.card!.id, browser: false, partialRender: false },
                { alertOnError: false },
            );
            html.current = {
                css: rendered.css,
                q: nodesToHtml(rendered.questionNodes),
                a: nodesToHtml(rendered.answerNodes),
            };
            setSrcdoc(buildCardSrcdoc(rendered.css, html.current.q));
            shownAt.current = Date.now();
            setPhase("question");
        } catch {
            // No open collection / backend unreachable — stay honest, never fake a card.
            setQueued(null);
            setPhase("nocol");
        }
    }, [onEmpty]);

    useEffect(() => {
        answered.current = 0;
        void loadNext();
    }, [loadNext, scopeKey]);

    const reveal = useCallback((): void => {
        setSrcdoc(buildCardSrcdoc(html.current.css, html.current.a));
        setPhase("answer");
    }, []);

    const grade = useCallback(
        async (rating: CardAnswer_Rating): Promise<void> => {
            if (busy.current || !queued?.card || !queued.states?.current) {
                return;
            }
            const states = queued.states;
            const newState = {
                [CardAnswer_Rating.AGAIN]: states.again,
                [CardAnswer_Rating.HARD]: states.hard,
                [CardAnswer_Rating.GOOD]: states.good,
                [CardAnswer_Rating.EASY]: states.easy,
            }[rating];
            if (!newState) {
                return;
            }
            busy.current = true;
            const msTaken = Math.min(Date.now() - shownAt.current, 60_000);
            try {
                await answerCard(
                    {
                        cardId: queued.card.id,
                        currentState: states.current,
                        newState,
                        rating,
                        answeredAtMillis: BigInt(Date.now()),
                        millisecondsTaken: msTaken,
                    },
                    { alertOnError: false },
                );
                answered.current += 1;
                onGraded({ rating, msTaken, deckId: queued.card.deckId });
            } catch {
                // If the write fails we still advance rather than trapping the user.
            } finally {
                busy.current = false;
            }
            await loadNext();
        },
        [queued, loadNext, onGraded],
    );

    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            // Escape must close from EVERY phase — buried in the else-chain it was
            // unreachable whenever an answer was showing.
            if (e.key === "Escape") {
                onClose();
                return;
            }
            if (e.key === " " || e.key === "Enter") {
                if (phase === "question") {
                    e.preventDefault();
                    reveal();
                }
            } else if (phase === "answer") {
                const map: Record<string, CardAnswer_Rating> = {
                    "1": CardAnswer_Rating.AGAIN,
                    "2": CardAnswer_Rating.HARD,
                    "3": CardAnswer_Rating.GOOD,
                    "4": CardAnswer_Rating.EASY,
                };
                if (e.key in map) {
                    e.preventDefault();
                    void grade(map[e.key]);
                }
            }
        }
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    }, [phase, reveal, grade, onClose]);

    return (
        /* No nested role="dialog": the keeper-panel-shell above already owns it. */
        <div className="keeper-panel">
            <div className="keeper-panel-header">
                <span className="keeper-context">{contextLabel ?? "Today's tending"}</span>
                <span className="keeper-counts" aria-label="cards remaining">
                    <span className="count-new">{counts.new}</span>
                    <span className="count-learning">{counts.learning}</span>
                    <span className="count-review">{counts.review}</span>
                </span>
                <button className="keeper-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
            </div>

            {(phase === "question" || phase === "answer") && (
                <>
                    <iframe
                        className="keeper-card-frame"
                        title="card"
                        sandbox="allow-scripts"
                        srcDoc={srcdoc}
                    />
                    {phase === "question"
                        ? (
                            <div className="keeper-actions">
                                <button className="keeper-reveal" onClick={reveal}>
                                    Show answer <kbd>Space</kbd>
                                </button>
                            </div>
                        )
                        : (
                            <div className="keeper-actions keeper-grades">
                                <button
                                    className="grade grade-again"
                                    onClick={() => void grade(CardAnswer_Rating.AGAIN)}
                                >
                                    Again <kbd>1</kbd>
                                </button>
                                <button
                                    className="grade grade-hard"
                                    onClick={() => void grade(CardAnswer_Rating.HARD)}
                                >
                                    Hard <kbd>2</kbd>
                                </button>
                                <button
                                    className="grade grade-good"
                                    onClick={() => void grade(CardAnswer_Rating.GOOD)}
                                >
                                    Good <kbd>3</kbd>
                                </button>
                                <button
                                    className="grade grade-easy"
                                    onClick={() => void grade(CardAnswer_Rating.EASY)}
                                >
                                    Easy <kbd>4</kbd>
                                </button>
                            </div>
                        )}
                </>
            )}

            {phase === "loading" && <div className="keeper-status">…</div>}
            {phase === "empty" && (
                <div className="keeper-status">
                    All caught up here. The garden grows while you rest.
                </div>
            )}
            {phase === "nocol" && (
                <div className="keeper-status" role="alert">
                    The Keeper cannot reach the collection right now.
                </div>
            )}
        </div>
    );
}

export function isFastAnswer(msTaken: number): boolean {
    return msTaken <= FAST_ANSWER_MS;
}
