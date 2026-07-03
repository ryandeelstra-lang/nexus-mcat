// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the voice Keeper reviewer (voice spec §3) — REPLACES the reveal + 1-4
// self-grade. The Keeper asks (a reworded variant when authored), you speak or type, the
// server grades and applies the real answerCard. The classic StudyCard remains ONLY as the
// escape-hatch fallback (CHARGED_UP_VOICE_REVIEWS=0). Controls live in the React chrome,
// never inside the sandboxed card iframe (opaque origin by design — card-render.ts).
import React, { useCallback, useEffect, useRef, useState } from "react";

import { renderExistingCard } from "@generated/backend";

import { buildCardSrcdoc, nodesToHtml } from "./card-render";
import { StudyCard } from "./StudyCard";
import { useTextCrawl } from "./use-text-crawl";
import { useVoiceReview } from "./use-voice-review";
import type { VoiceBucket, VoiceGradeResult } from "./voice-api";
import { micSupported } from "./voice-capture";

export interface VoiceGradedEvent {
    /** Client CardAnswer_Rating (0-3), already converted from the server's v3 ease. */
    rating: number;
    msTaken: number;
    /** null on the classic-fallback path (no bucket exists there). */
    bucket: VoiceBucket | null;
    recovered: boolean;
    bloomed: boolean;
    isFreshVariant: boolean;
}

export interface VoiceStudyCardProps {
    onGraded(event: VoiceGradedEvent): void;
    onEmpty(counts: { answered: number }): void;
    onClose(): void;
    onNoVariant?(): void;
    contextLabel?: string;
    scopeKey: string;
    preferVariant?: boolean;
    singleCard?: boolean;
}

// Bucket beats signal by WORDS + shape, never hue alone (voice spec §11).
const BUCKET_BEAT: Record<VoiceBucket, { title: string; icon: string; tone: string }> = {
    good: { title: "The plant drinks deep!", icon: "✿", tone: "voice-beat-good" },
    okay: { title: "Good — it grows.", icon: "🌱", tone: "voice-beat-okay" },
    ask_again: { title: "Let's try that another way.", icon: "↻", tone: "voice-beat-ask" },
    dont_know: {
        title: "That's okay — we'll water it.",
        icon: "💧",
        tone: "voice-beat-idk",
    },
};

export function VoiceStudyCard(props: VoiceStudyCardProps): React.ReactElement {
    const {
        onGraded,
        onEmpty,
        onClose,
        onNoVariant,
        contextLabel,
        scopeKey,
        preferVariant,
        singleCard,
    } = props;
    const [typed, setTyped] = useState("");
    const [srcdoc, setSrcdoc] = useState("");
    const typedRef = useRef<HTMLInputElement | null>(null);

    const review = useVoiceReview({
        scopeKey,
        preferVariant,
        singleCard,
        onGraded: (result: VoiceGradeResult, msTaken: number) => {
            onGraded({
                rating: result.rating,
                msTaken,
                bucket: result.bucket,
                recovered: result.recovered,
                bloomed: result.bloomed,
                isFreshVariant: result.isFreshVariant,
            });
        },
        onEmpty,
        onNoVariant,
    });
    const { state } = review;

    // A new scope (deck) means a fresh session. loadNext/cancel are stable callbacks, so
    // scopeKey is deliberately the only trigger (a re-render must not restart the session).
    const loadNextRef = useRef(review.loadNext);
    loadNextRef.current = review.loadNext;
    const cancelRef = useRef(review.cancel);
    cancelRef.current = review.cancel;
    useEffect(() => {
        setTyped("");
        void loadNextRef.current();
        return () => cancelRef.current();
    }, [scopeKey]);

    // Render the served card's question HTML (readable font, sandboxed iframe).
    useEffect(() => {
        const cardId = state.card?.cardId;
        if (!cardId) {
            setSrcdoc("");
            return;
        }
        let cancelled = false;
        void renderExistingCard(
            { cardId: BigInt(cardId), browser: false, partialRender: false },
            { alertOnError: false },
        )
            .then((rendered) => {
                if (!cancelled) {
                    setSrcdoc(
                        buildCardSrcdoc(rendered.css, nodesToHtml(rendered.questionNodes)),
                    );
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSrcdoc("");
                }
            });
        return () => {
            cancelled = true;
        };
    }, [state.card?.cardId]);

    const answerable = state.phase === "prompt" || state.phase === "rePrompt";
    const canMic = state.stt.available && micSupported();

    const keeperLine = state.rePrompt?.keeperLine ?? state.card?.keeperLine ?? "";
    const counts = state.card?.counts ?? { new: 0, learning: 0, review: 0 };
    // The line crawls out Zelda-style; the sr-only copy carries it for AT (spec §11).
    // Declared before the classic-fallback early return so hook order never changes.
    const crawl = useTextCrawl(keeperLine);

    const submitTyped = useCallback(async (): Promise<void> => {
        const text = typed;
        setTyped("");
        await review.submitTyped(text);
    }, [typed, review]);

    // Keyboard: Space toggles the mic ONLY when focus is outside the typed field (§11);
    // Enter submits typed; Enter/Space advances a result; Escape closes.
    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            if (e.key === "Escape") {
                onClose();
                return;
            }
            const inField = e.target === typedRef.current;
            if (e.key === " " && !inField) {
                e.preventDefault();
                if (state.phase === "listening") {
                    void review.stopAndGrade();
                } else if (answerable && canMic) {
                    void review.startListening();
                } else if (state.phase === "result") {
                    void review.advance();
                }
            } else if (e.key === "Enter") {
                if (inField && answerable) {
                    e.preventDefault();
                    void submitTyped();
                } else if (state.phase === "result") {
                    e.preventDefault();
                    void review.advance();
                }
            }
        }
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    }, [state.phase, answerable, canMic, review, submitTyped, onClose]);

    // Escape hatch: the server said voice is off -> the classic reveal/1-4 reviewer.
    if (state.phase === "classic") {
        return (
            <StudyCard
                scopeKey={scopeKey}
                contextLabel={contextLabel}
                onClose={onClose}
                onEmpty={onEmpty}
                onGraded={(event) =>
                    onGraded({
                        rating: event.rating,
                        msTaken: event.msTaken,
                        bucket: null,
                        recovered: false,
                        bloomed: false,
                        isFreshVariant: false,
                    })}
            />
        );
    }

    return (
        <div className="keeper-panel" role="dialog" aria-label="The Keeper's questions">
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

            {(answerable || state.phase === "listening" || state.phase === "thinking") && (
                <>
                    <div className="voice-keeper-line" onClick={crawl.finish}>
                        <p aria-hidden="true">
                            {crawl.shown}
                            {!crawl.done && <span className="voice-caret" />}
                        </p>
                        <p className="sr-only" aria-live="polite">{keeperLine}</p>
                        {state.rePrompt?.hint && <p className="voice-hint">{state.rePrompt.hint}</p>}
                        {state.card?.isFreshVariant && (
                            <span
                                className="voice-variant-badge"
                                title="A reworded ask — passing it blooms the plant"
                            >
                                reworded ✿
                            </span>
                        )}
                    </div>
                    {srcdoc && (
                        <iframe
                            className="keeper-card-frame voice-card-frame"
                            title="card"
                            sandbox="allow-scripts"
                            srcDoc={srcdoc}
                        />
                    )}

                    {state.micError && (
                        <div className="keeper-status" role="alert">
                            {state.micError}
                        </div>
                    )}

                    {state.phase === "thinking"
                        ? (
                            <div className="keeper-status voice-thinking">
                                The Keeper considers…
                            </div>
                        )
                        : (
                            <div className="keeper-actions voice-answer-row">
                                {canMic && state.phase !== "listening" && (
                                    <button
                                        className="voice-mic"
                                        onClick={() => void review.startListening()}
                                        disabled={!answerable}
                                    >
                                        🎤 Speak <kbd>Space</kbd>
                                    </button>
                                )}
                                {state.phase === "listening" && (
                                    <button
                                        className="voice-mic voice-mic-live"
                                        onClick={() => void review.stopAndGrade()}
                                    >
                                        ◼ Done — grade it <kbd>Space</kbd>
                                    </button>
                                )}
                                <form
                                    className="voice-type-row"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        void submitTyped();
                                    }}
                                >
                                    <input
                                        ref={typedRef}
                                        className="voice-type-field"
                                        value={typed}
                                        onChange={(e) => setTyped(e.target.value)}
                                        placeholder={canMic
                                            ? "…or type your answer"
                                            : "Type your answer"}
                                        disabled={state.phase === "listening"}
                                        aria-label="Type your answer"
                                    />
                                    <button
                                        type="submit"
                                        className="hud-ghost-button"
                                        disabled={!typed.trim()
                                            || state.phase === "listening"}
                                    >
                                        Answer
                                    </button>
                                </form>
                                <button
                                    className="voice-idk hud-ghost-button"
                                    onClick={() => void review.sayIdk()}
                                    disabled={state.phase === "listening"}
                                >
                                    I don't know
                                </button>
                            </div>
                        )}
                </>
            )}

            {state.phase === "result" && state.result && (
                <div
                    className={`voice-result ${BUCKET_BEAT[state.result.bucket].tone}`}
                    aria-live="polite"
                >
                    <h3>
                        <span className="voice-beat-icon" aria-hidden="true">
                            {BUCKET_BEAT[state.result.bucket].icon}
                        </span>{" "}
                        {BUCKET_BEAT[state.result.bucket].title}
                        {state.result.recovered && <span className="voice-recovered-tag">recovered</span>}
                        {state.result.bloomed && <span className="voice-bloom-tag">bloom ✿</span>}
                    </h3>
                    <p className="voice-transcript">
                        You said: “{state.result.transcript}”
                    </p>
                    <p className="voice-answer">Answer: {state.result.correctAnswer}</p>
                    {state.result.rationale && <p className="voice-why">{state.result.rationale}</p>}
                    {state.result.keyPointsHit.length > 0 && (
                        <p className="voice-points-hit">
                            ✓ {state.result.keyPointsHit.join(" · ")}
                        </p>
                    )}
                    {state.result.keyPointsMissed.length > 0 && (
                        <p className="voice-points-missed">
                            ✗ {state.result.keyPointsMissed.join(" · ")}
                        </p>
                    )}
                    <p className="voice-score">match {Math.round(state.result.score)}%</p>
                    {state.result.sentinel && (
                        <p className="voice-sentinel" role="note">
                            {state.result.sentinel}
                        </p>
                    )}
                    <div className="keeper-actions">
                        <button
                            className="keeper-reveal"
                            onClick={() => void review.advance()}
                        >
                            Continue <kbd>Enter</kbd>
                        </button>
                        <button
                            className="voice-appeal hud-ghost-button"
                            onClick={() => review.appeal()}
                        >
                            That's not what I said
                        </button>
                    </div>
                </div>
            )}

            {state.phase === "loading" && <div className="keeper-status">…</div>}
            {state.phase === "empty" && (
                <div className="keeper-status">
                    All caught up here. The garden grows while you rest.
                </div>
            )}
            {state.phase === "noVariant" && (
                <div className="keeper-status">
                    No reworded ask is ready for this plot yet.
                </div>
            )}
            {state.phase === "error" && (
                <div className="keeper-status" role="alert">
                    The Keeper cannot reach the collection right now. {state.errorMessage}
                </div>
            )}
        </div>
    );
}
