// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Keeper conversation (voice spec §3; dialogue-UX rework 2026-07-03). The Keeper
// never speaks aloud — he TALKS IN TEXT: each ask lands one word at a time on a human cadence,
// your own words stream below as you speak (display-only captions), and the INSTANT you stop
// recording (or submit) he starts composing his reply — an opener crawls out, the "…" typing
// dots hold the beat while the server grades, and the reply talks on into the real answer, the
// why, and his verdict. Controls: one big mic coin, a compact type-instead field, and a slim
// "I don't know" bar. The classic StudyCard remains ONLY as the escape-hatch fallback
// (CHARGED_UP_VOICE_REVIEWS=0). Grading is entirely server-side and unchanged; the live captions
// here are display-only and never sent anywhere.
import React, { useCallback, useEffect, useRef, useState } from "react";

import { renderExistingCard } from "@generated/backend";

import { assetUrl } from "../game/assets";
import { buildCardSrcdoc, nodesToHtml } from "./card-render";
import { KeeperDialogue } from "./KeeperDialogue";
import { StudyCard } from "./StudyCard";
import { useLiveTranscript } from "./use-live-transcript";
import {
    composeKeeperReply,
    pickOpener,
    useTalkingReveal,
    verdictFor,
    WORD_BASE_MS,
    wordsOf,
} from "./use-talking-reveal";
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

// Bucket beats signal by WORDS + shape, never hue alone (voice spec §11). The verdict sentence
// lives IN the Keeper's spoken reply (verdictFor); this adds the plant flavor to the tray.
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
    // The wrong "assets/char/…" path silently 404'd, so the Keeper had no face. Resolve the
    // bundled URL through the same glob the world uses (dev + prod safe).
    return assetUrl("keeper-portrait") ?? "";
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
    const [typeOpen, setTypeOpen] = useState(false);
    const [srcdoc, setSrcdoc] = useState("");
    const [cardHasMedia, setCardHasMedia] = useState(false);
    // One reply "beat" per submission — seeds the opener and resets the reply crawl.
    const [beat, setBeat] = useState(0);
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
        setTypeOpen(false);
        void loadNextRef.current();
        return () => cancelRef.current();
    }, [scopeKey]);

    // Render the served card's question HTML (readable font, sandboxed iframe) — kept ONLY for cards
    // with non-text media; a plain-text question rides the dialogue line instead.
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
    const asking = answerable || state.phase === "listening";
    const replying = state.phase === "thinking" || state.phase === "result";
    const canMic = state.stt.available && micSupported();
    const showTypeRow = typeOpen || !canMic;

    const keeperLine = state.rePrompt?.keeperLine ?? state.card?.keeperLine ?? "";
    const counts = state.card?.counts ?? { new: 0, learning: 0, review: 0 };

    // The ask talks out word by word (~70ms, jittered), but a long MCAT ask must not
    // gate the player for 3s+ — the cadence compresses so any ask lands within ~1.8s
    // while short asks keep the full villager feel. A re-prompt re-asks the same line,
    // so the reset key includes the phase flavor. Declared before the classic-fallback
    // early return so hook order never changes.
    const askWordCount = wordsOf(keeperLine).length;
    const askReveal = useTalkingReveal(keeperLine, {
        resetKey: `${state.card?.cardId ?? "none"}:${state.phase === "rePrompt" ? "re" : "ask"}`,
        baseMs: Math.min(WORD_BASE_MS, Math.max(28, Math.round(1800 / Math.max(1, askWordCount)))),
    });

    // The Keeper's reply: the opener starts crawling the INSTANT a submission begins
    // (phase: thinking), the typing dots hold the beat, and when the grade lands the same
    // crawl talks on into the answer, the why, and the verdict — no restart, no dead air.
    const replySeed = `${state.card?.cardId ?? "none"}:${beat}`;
    const opener = pickOpener(replySeed);
    // While the grade is still in flight, the revealed reference answer (fetched at submit,
    // no AI round-trip) lets the Keeper speak "The answer: …" right away; the graded reply
    // then GROWS the same text with the why + verdict (prefix-stable, so the crawl never
    // restarts — both strings come from composeKeeperReply with the same opener + answer).
    let replyText = opener;
    if (state.result) {
        replyText = composeKeeperReply({
            opener,
            correctAnswer: state.result.correctAnswer,
            rationale: state.result.rationale,
            verdictHeadline: verdictFor(state.result.bucket).headline,
        });
    } else if (state.revealedAnswer) {
        replyText = composeKeeperReply({
            opener,
            correctAnswer: state.revealedAnswer,
            rationale: "",
            verdictHeadline: "",
        });
    }
    // Replies run 2-3x longer than asks — a touch brisker so the verdict lands while
    // the moment is still warm (the details tray + Continue are never gated on this).
    const replyReveal = useTalkingReveal(replying ? replyText : "", {
        final: state.phase === "result",
        resetKey: replySeed,
        baseMs: 55,
        jitterMs: 25,
    });

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
        setBeat((b) => b + 1);
        void review.stopAndGrade();
    };
    const askRevealRef = useRef(askReveal);
    askRevealRef.current = askReveal;
    const replyRevealRef = useRef(replyReveal);
    replyRevealRef.current = replyReveal;

    // Snappy feel: when typing is the input (no mic), focus the field the moment a fresh ask
    // is answerable. Never steals focus mid-listen/thinking.
    useEffect(() => {
        if (answerable && showTypeRow) {
            typedRef.current?.focus();
        }
    }, [answerable, showTypeRow, state.card?.cardId]);

    const submitTyped = useCallback(async (): Promise<void> => {
        const text = typed;
        if (!text.trim()) {
            return;
        }
        // Keep the text until the grade actually lands — a timeout/mic-error path hands
        // the turn back, and the player must not have to retype from scratch.
        setBeat((b) => b + 1);
        await review.submitTyped(text);
    }, [typed, review]);

    // Clear the typed draft only once the attempt truly resolved.
    useEffect(() => {
        if (state.phase === "result" || state.phase === "rePrompt") {
            setTyped("");
        }
    }, [state.phase]);

    // A re-prompt re-asks a line the player JUST heard — land it instantly and let the
    // hint be the news. (The crawl is for new words only.)
    useEffect(() => {
        if (state.phase === "rePrompt") {
            askRevealRef.current.finish();
        }
    }, [state.phase]);

    const sayIdk = useCallback(async (): Promise<void> => {
        setBeat((b) => b + 1);
        await review.sayIdk();
    }, [review]);

    // Keyboard: Space toggles the mic ONLY when focus is outside the typed field (§11); Enter
    // submits typed; on a reply, Space/Enter first snap the crawl, then advance; Escape closes.
    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            if (e.key === "Escape") {
                onClose();
                return;
            }
            const target = e.target as HTMLElement | null;
            const inField = e.target === typedRef.current;
            // A focused control keeps its own keys (Space/Enter must ACTIVATE the focused
            // appeal/IDK/close button, not hijack into mic-start or advance).
            if (
                !inField && target
                && target.closest("button, input, textarea, select, a, [role='button']")
            ) {
                return;
            }
            if (e.key === " " && !inField) {
                e.preventDefault();
                if (asking && !askRevealRef.current.done) {
                    // First press lands the whole ask — the crawl is decoration, never a gate.
                    askRevealRef.current.finish();
                } else if (state.phase === "listening") {
                    stopSpeakingRef.current();
                } else if (answerable && canMic) {
                    startSpeakingRef.current();
                } else if (state.phase === "result") {
                    if (!replyRevealRef.current.done) {
                        replyRevealRef.current.finish();
                    } else {
                        void review.advance();
                    }
                }
            } else if (e.key === "Enter") {
                if (inField && answerable) {
                    e.preventDefault();
                    void submitTyped();
                } else if (asking && !askRevealRef.current.done) {
                    e.preventDefault();
                    askRevealRef.current.finish();
                } else if (state.phase === "result") {
                    e.preventDefault();
                    if (!replyRevealRef.current.done) {
                        replyRevealRef.current.finish();
                    } else {
                        void review.advance();
                    }
                }
            }
        }
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    }, [state.phase, asking, answerable, canMic, review, submitTyped, onClose]);

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
    const micArt = assetUrl("ui-btn-mic");
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
    const listening = state.phase === "listening";

    return (
        <div className="keeper-panel keeper-panel-dialogue">
            {
                /* ONE persistent live region: aria-live only announces mutations inside an
              * existing node, so this must never conditionally mount. It mirrors the ask
              * and the full graded reply (the visible word-crawl is aria-hidden). */
            }
            <p className="sr-only" role="status" aria-live="polite">
                {state.phase === "result" ? replyText : keeperLine}
            </p>
            <div className="keeper-panel-header">
                <span className="keeper-context">{contextLabel ?? "Today's tending"}</span>
                <span className="keeper-counts">
                    <span className="count-new" title="new">
                        <span className="sr-only">new{" "}</span>
                        {counts.new}
                    </span>
                    <span className="count-learning" title="learning">
                        <span className="sr-only">learning{" "}</span>
                        {counts.learning}
                    </span>
                    <span className="count-review" title="to review">
                        <span className="sr-only">to review{" "}</span>
                        {counts.review}
                    </span>
                </span>
                <button className="keeper-close" onClick={onClose} aria-label="Close">
                    ✕
                </button>
            </div>

            {asking && (
                <>
                    <KeeperDialogue
                        portraitSrc={portraitSrc}
                        body={askReveal.shown}
                        srText={keeperLine}
                        showCaret={!askReveal.done}
                        onBodyClick={askReveal.finish}
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

                        <div className="voice-answer-stage">
                            {canMic && (
                                <span className="voice-mic-stack">
                                    <button
                                        className={`voice-mic-coin${listening ? " voice-mic-coin-live" : ""}`}
                                        style={micArt ? { backgroundImage: `url("${micArt}")` } : undefined}
                                        onClick={() =>
                                            listening
                                                ? stopSpeakingRef.current()
                                                : startSpeakingRef.current()}
                                        disabled={!answerable && !listening}
                                        aria-label={listening
                                            ? "Done — the Keeper will consider it"
                                            : "Speak your answer"}
                                        aria-keyshortcuts="Space"
                                    >
                                        {
                                            /* Fallback glyph: the primary answer control must
                                          * never be an invisible 96px square if the coin
                                          * art fails to resolve. */
                                        }
                                        {!micArt && <span aria-hidden="true" style={{ fontSize: 40 }}>🎤</span>}
                                        {listening && <span className="voice-mic-stop" aria-hidden="true">◼</span>}
                                    </button>
                                    <span className="voice-mic-label" aria-hidden="true">
                                        {listening
                                            ? (
                                                <>
                                                    done — <kbd>Space</kbd>
                                                </>
                                            )
                                            : (
                                                <>
                                                    speak — <kbd>Space</kbd>
                                                </>
                                            )}
                                    </span>
                                </span>
                            )}

                            {listening && (
                                /* Display-only captions: aria-hidden, or a screen reader
                                 * narrates the player's own half-recognized words back
                                 * over them while they speak. */
                                <div className="voice-player-line" aria-hidden="true">
                                    <span className="voice-player-name">You</span>
                                    {live.supported && live.display
                                        ? (
                                            <p className="voice-live-text">
                                                {live.display}
                                                <span className="voice-caret" />
                                            </p>
                                        )
                                        : (
                                            <p className="voice-live-pulse">
                                                listening<span className="keeper-typing-dots">
                                                    <span />
                                                    <span />
                                                    <span />
                                                </span>
                                            </p>
                                        )}
                                    {live.supported && live.display && (
                                        <span className="voice-live-tag">live captions — best guess</span>
                                    )}
                                </div>
                            )}

                            {!listening && (
                                <>
                                    {showTypeRow
                                        ? (
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
                                                    placeholder="Type your answer…"
                                                    disabled={!answerable}
                                                    aria-label="Type your answer"
                                                />
                                                <button
                                                    type="submit"
                                                    className="hud-ghost-button"
                                                    disabled={!typed.trim() || !answerable}
                                                >
                                                    Answer
                                                </button>
                                            </form>
                                        )
                                        : (
                                            <button
                                                className="voice-type-toggle"
                                                onClick={() => setTypeOpen(true)}
                                            >
                                                …or type it
                                            </button>
                                        )}
                                </>
                            )}
                        </div>

                        {state.stt.hosted && canMic && (
                            <p className="voice-hosted-disclosure" role="note">
                                Voice is sent to OpenAI to transcribe. Type instead to keep it local.
                            </p>
                        )}
                    </KeeperDialogue>

                    {!listening && (
                        <button
                            className="voice-idk-bar"
                            onClick={() => void sayIdk()}
                            disabled={!answerable}
                        >
                            I don't know — show me
                        </button>
                    )}
                </>
            )}

            {replying && (
                <KeeperDialogue
                    portraitSrc={portraitSrc}
                    tone={state.result ? BUCKET_BEAT[state.result.bucket].tone : undefined}
                    body={replyReveal.shown}
                    srText={state.phase === "result" ? replyText : undefined}
                    showCaret={!replyReveal.done && !replyReveal.waiting}
                    dots={replyReveal.waiting}
                    onBodyClick={replyReveal.finish}
                    onContinue={state.phase === "result"
                        ? () => {
                            // Input is never gated on the crawl: first press lands the
                            // words, the next one advances.
                            if (!replyReveal.done) {
                                replyReveal.finish();
                            } else {
                                void review.advance();
                            }
                        }
                        : undefined}
                    continueLabel="Continue — Enter"
                >
                    {state.phase === "result" && state.result && (
                        <div className="voice-result-details" aria-live="polite">
                            <p className="voice-flavor">
                                <span className="voice-beat-icon" aria-hidden="true">
                                    {BUCKET_BEAT[state.result.bucket].icon}
                                </span>{" "}
                                {BUCKET_BEAT[state.result.bucket].flavor}
                                {state.result.recovered && <span className="voice-recovered-tag">recovered</span>}
                                {state.result.bloomed && <span className="voice-bloom-tag">bloom ✿</span>}
                            </p>
                            {
                                /* An honest "I don't know" has no transcript — don't taunt with
                              * an empty quote, a 0% match, or an appeal to words never said. */
                            }
                            {state.result.transcript.trim() !== "" && (
                                <p className="voice-transcript">
                                    You said: “{state.result.transcript}”
                                </p>
                            )}
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
                            {state.result.transcript.trim() !== "" && (
                                <p className="voice-score">match {Math.round(state.result.score)}%</p>
                            )}
                            {state.result.sentinel && (
                                <p className="voice-sentinel" role="note">
                                    {state.result.sentinel}
                                </p>
                            )}
                            {state.result.transcript.trim() !== "" && (
                                <button
                                    className="voice-appeal"
                                    onClick={() => review.appeal()}
                                >
                                    That's not what I said
                                </button>
                            )}
                        </div>
                    )}
                </KeeperDialogue>
            )}

            {
                /* Between cards the frame STAYS — the Keeper pausing for the next question,
              * not the whole stage blinking out into a bare "…" sliver. */
            }
            {state.phase === "loading" && <KeeperDialogue portraitSrc={portraitSrc} body="" dots srText="" />}
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
