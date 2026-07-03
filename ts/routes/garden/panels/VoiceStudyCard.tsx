// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the voice Keeper reviewer (voice spec §3; dialogue-UX plan). REPLACES the reveal +
// 1-4 self-grade with a conversation: the Keeper asks (a reworded variant when authored) inside an
// indie dialogue box, you speak (seeing live captions) or type, the server grades, and the Keeper
// replies as streamed dialogue that lands on a verdict. The classic StudyCard remains ONLY as the
// escape-hatch fallback (CHARGED_UP_VOICE_REVIEWS=0). Grading is entirely server-side and unchanged;
// the live captions here are display-only and never sent anywhere (dialogue-UX plan §2).
import React, { useCallback, useEffect, useRef, useState } from "react";

import { renderExistingCard } from "@generated/backend";

import { buildCardSrcdoc, nodesToHtml } from "./card-render";
import { composeKeeperReply, useDialogueReveal, verdictFor } from "./use-dialogue-reveal";
import { KeeperDialogue } from "./KeeperDialogue";
import { StudyCard } from "./StudyCard";
import { useKeeperTts } from "./use-keeper-tts";
import { useLiveTranscript } from "./use-live-transcript";
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

// Bucket beats signal by WORDS + shape, never hue alone (voice spec §11). The headline is the
// user-facing verdict ("You got it" / "Maybe next time", see verdictFor); this adds the plant flavor.
const BUCKET_BEAT: Record<VoiceBucket, { flavor: string; icon: string; tone: string }> = {
    good: { flavor: "The plant drinks deep!", icon: "✿", tone: "voice-beat-good" },
    okay: { flavor: "It grows a little.", icon: "🌱", tone: "voice-beat-okay" },
    ask_again: { flavor: "Let's try that another way.", icon: "↻", tone: "voice-beat-ask" },
    dont_know: { flavor: "That's okay — we'll water it.", icon: "💧", tone: "voice-beat-idk" },
};

// Cards whose question carries images / SVG / MathJax still need the sandboxed render; plain-text
// cards are carried by the dialogue line alone (legibility — dialogue-UX plan §5).
const MEDIA_MARKER = /<img|<svg|mjx-|\\\(|\\\[|\$\$/i;

function keeperPortraitSrc(): string {
    return new URL("../assets/char/keeper-portrait.png", globalThis.location.href).toString();
}

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
    const [cardHasMedia, setCardHasMedia] = useState(false);
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
    const live = useLiveTranscript();

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

    // Render the served card's question HTML (readable font, sandboxed iframe) — kept ONLY for cards
    // with non-text media; a plain-text question rides in the dialogue line instead.
    useEffect(() => {
        const cardId = state.card?.cardId;
        if (!cardId) {
            setSrcdoc("");
            setCardHasMedia(false);
            return;
        }
        let cancelled = false;
        void renderExistingCard(
            { cardId: BigInt(cardId), browser: false, partialRender: false },
            { alertOnError: false },
        )
            .then((rendered) => {
                if (!cancelled) {
                    const questionHtml = nodesToHtml(rendered.questionNodes);
                    setSrcdoc(buildCardSrcdoc(rendered.css, questionHtml));
                    setCardHasMedia(MEDIA_MARKER.test(questionHtml));
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSrcdoc("");
                    setCardHasMedia(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [state.card?.cardId]);

    // Fresh card -> clear any lingering live captions before the next ask.
    const liveResetRef = useRef(live.reset);
    liveResetRef.current = live.reset;
    useEffect(() => {
        liveResetRef.current();
    }, [state.card?.cardId]);

    const answerable = state.phase === "prompt" || state.phase === "rePrompt";
    const canMic = state.stt.available && micSupported();

    const keeperLine = state.rePrompt?.keeperLine ?? state.card?.keeperLine ?? "";
    const counts = state.card?.counts ?? { new: 0, learning: 0, review: 0 };
    // The line crawls out Zelda-style; the sr-only copy carries it for AT (spec §11).
    // Declared before the classic-fallback early return so hook order never changes.
    const crawl = useTextCrawl(keeperLine);
    const tts = useKeeperTts();

    // The Keeper's graded reply, streamed a few words at a time (dialogue-UX plan §4): the real
    // definition first, then the "why"; the verdict lands when the crawl finishes.
    const replyText = state.result
        ? composeKeeperReply({
            correctAnswer: state.result.correctAnswer,
            rationale: state.result.rationale,
        })
        : "";
    const reveal = useDialogueReveal(replyText);
    const verdict = state.result ? verdictFor(state.result.bucket) : null;

    // Speak = record for the real server grade AND show display-only live captions (never sent).
    const startSpeakingRef = useRef<() => void>(() => undefined);
    startSpeakingRef.current = () => {
        live.reset();
        live.start();
        void review.startListening();
    };
    const stopSpeakingRef = useRef<() => void>(() => undefined);
    stopSpeakingRef.current = () => {
        live.stop();
        void review.stopAndGrade();
    };
    const revealRef = useRef(reveal);
    revealRef.current = reveal;

    // The Keeper speaks each new ask aloud (question only, never the answer — spec §6).
    const speakRef = useRef(tts.speak);
    speakRef.current = tts.speak;
    useEffect(() => {
        if (keeperLine && answerable) {
            speakRef.current(keeperLine);
        }
    }, [keeperLine, answerable]);
    const stopRef = useRef(tts.stop);
    stopRef.current = tts.stop;
    useEffect(() => () => stopRef.current(), []);

    const submitTyped = useCallback(async (): Promise<void> => {
        const text = typed;
        setTyped("");
        await review.submitTyped(text);
    }, [typed, review]);

    // Keyboard: Space toggles the mic ONLY when focus is outside the typed field (§11); Enter submits
    // typed; on a result, Space/Enter first completes the streamed reply, then advances; Escape closes.
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
                    stopSpeakingRef.current();
                } else if (answerable && canMic) {
                    startSpeakingRef.current();
                } else if (state.phase === "result") {
                    if (!revealRef.current.done) {
                        revealRef.current.finish();
                    } else {
                        void review.advance();
                    }
                }
            } else if (e.key === "Enter") {
                if (inField && answerable) {
                    e.preventDefault();
                    void submitTyped();
                } else if (state.phase === "result") {
                    e.preventDefault();
                    if (!revealRef.current.done) {
                        revealRef.current.finish();
                    } else {
                        void review.advance();
                    }
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

    const portraitSrc = keeperPortraitSrc();
    const variantBadge = state.card?.isFreshVariant
        ? (
            <span
                className="voice-variant-badge"
                title="A reworded ask — passing it blooms the plant"
            >
                reworded ✿
            </span>
        )
        : undefined;

    return (
        <div className="keeper-panel keeper-panel-dialogue" role="dialog" aria-label="The Keeper's questions">
            <div className="keeper-panel-header">
                <span className="keeper-context">{contextLabel ?? "Today's tending"}</span>
                <span className="keeper-counts" aria-label="cards remaining">
                    <span className="count-new">{counts.new}</span>
                    <span className="count-learning">{counts.learning}</span>
                    <span className="count-review">{counts.review}</span>
                </span>
                {tts.capable && (
                    <button
                        className="keeper-close voice-tts-toggle"
                        onClick={() => {
                            if (!tts.muted) {
                                tts.stop();
                            }
                            tts.setMuted(!tts.muted);
                        }}
                        aria-label={tts.muted
                            ? "Unmute the Keeper's voice"
                            : "Mute the Keeper's voice"}
                        title={tts.muted ? "Keeper voice off" : "Keeper voice on"}
                    >
                        {tts.muted ? "🔇" : "🔊"}
                    </button>
                )}
                <button className="keeper-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
            </div>

            {(answerable || state.phase === "listening" || state.phase === "thinking") && (
                <KeeperDialogue
                    portraitSrc={portraitSrc}
                    body={crawl.shown}
                    srText={keeperLine}
                    showCaret={!crawl.done}
                    onBodyClick={crawl.finish}
                    badge={variantBadge}
                >
                    {state.rePrompt?.hint && <p className="voice-hint">{state.rePrompt.hint}</p>}
                    {srcdoc && cardHasMedia && (
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
                    {state.stt.hosted && canMic && (
                        <p className="voice-hosted-disclosure" role="note">
                            Voice is sent to OpenAI to transcribe. Type instead to keep it local.
                        </p>
                    )}

                    {state.phase === "listening" && (
                        <div className="voice-live">
                            {live.supported && live.display
                                ? (
                                    <p className="voice-live-text" aria-hidden="true">
                                        {live.display}
                                        <span className="voice-caret" />
                                    </p>
                                )
                                : <p className="voice-live-pulse" aria-hidden="true">listening…</p>}
                            <span className="voice-live-tag">live captions — best guess</span>
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
                                        onClick={() => startSpeakingRef.current()}
                                        disabled={!answerable}
                                    >
                                        🎤 Speak <kbd>Space</kbd>
                                    </button>
                                )}
                                {state.phase === "listening" && (
                                    <button
                                        className="voice-mic voice-mic-live"
                                        onClick={() => stopSpeakingRef.current()}
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
                </KeeperDialogue>
            )}

            {state.phase === "result" && state.result && verdict && (
                <KeeperDialogue
                    portraitSrc={portraitSrc}
                    tone={BUCKET_BEAT[state.result.bucket].tone}
                    body={reveal.shown}
                    srText={replyText}
                    showCaret={!reveal.done}
                    onBodyClick={reveal.finish}
                >
                    {reveal.done && (
                        <div className="voice-result-details" aria-live="polite">
                            <h3 className="voice-verdict">
                                <span className="voice-beat-icon" aria-hidden="true">
                                    {BUCKET_BEAT[state.result.bucket].icon}
                                </span>{" "}
                                {verdict.headline}
                                {state.result.recovered && (
                                    <span className="voice-recovered-tag">recovered</span>
                                )}
                                {state.result.bloomed && <span className="voice-bloom-tag">bloom ✿</span>}
                            </h3>
                            <p className="voice-flavor">{BUCKET_BEAT[state.result.bucket].flavor}</p>
                            <p className="voice-transcript">
                                You said: “{state.result.transcript}”
                            </p>
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
                </KeeperDialogue>
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
