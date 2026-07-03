// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the voice-Keeper session state machine (voice spec §3). A reducer over the
// phases loading -> prompt -> (listening) -> thinking -> result|rePrompt, with honest
// terminal states (classic fallback, empty, noVariant, error). All server trust lives
// server-side; this hook only sequences UI and measures msTaken. The reducer is a pure
// exported function so every transition is unit-testable without a DOM.
import { useCallback, useMemo, useReducer, useRef } from "react";

import {
    fetchNextVoiceCard,
    gradeVoiceAnswer,
    type SttInfo,
    type VoiceGradeResult,
    type VoiceNextCard,
} from "./voice-api";
import { MicRecorder } from "./voice-capture";

export type VoicePhase =
    | "loading"
    | "classic"
    | "empty"
    | "noVariant"
    | "error"
    | "prompt"
    | "listening"
    | "thinking"
    | "result"
    | "rePrompt";

export interface VoiceReviewState {
    phase: VoicePhase;
    card: VoiceNextCard | null;
    stt: SttInfo;
    result: VoiceGradeResult | null;
    rePrompt: { keeperLine: string; hint: string } | null;
    micError: string;
    answered: number;
    errorMessage: string;
}

export type VoiceReviewAction =
    | { type: "loading" }
    | { type: "card"; card: VoiceNextCard; stt: SttInfo }
    | { type: "terminal"; phase: "classic" | "empty" | "noVariant" }
    | { type: "listening" }
    | { type: "thinking" }
    | { type: "result"; result: VoiceGradeResult }
    | { type: "rePrompt"; keeperLine: string; hint: string }
    | { type: "micError"; message: string }
    | { type: "backToPrompt" }
    | { type: "error"; message: string };

export const INITIAL_VOICE_STATE: VoiceReviewState = {
    phase: "loading",
    card: null,
    stt: { available: false, local: false, hosted: false },
    result: null,
    rePrompt: null,
    micError: "",
    answered: 0,
    errorMessage: "",
};

export function voiceReviewReducer(
    state: VoiceReviewState,
    action: VoiceReviewAction,
): VoiceReviewState {
    switch (action.type) {
        case "loading":
            return {
                ...state,
                phase: "loading",
                result: null,
                rePrompt: null,
                micError: "",
            };
        case "card":
            return {
                ...state,
                phase: "prompt",
                card: action.card,
                stt: action.stt,
                result: null,
                rePrompt: null,
                micError: "",
            };
        case "terminal":
            return { ...state, phase: action.phase, card: null };
        case "listening":
            return { ...state, phase: "listening", micError: "" };
        case "thinking":
            return { ...state, phase: "thinking" };
        case "result":
            return {
                ...state,
                phase: "result",
                result: action.result,
                answered: state.answered + 1,
            };
        case "rePrompt":
            return {
                ...state,
                phase: "rePrompt",
                rePrompt: { keeperLine: action.keeperLine, hint: action.hint },
            };
        case "micError":
            return { ...state, phase: "prompt", micError: action.message };
        case "backToPrompt":
            return { ...state, phase: "prompt", result: null };
        case "error":
            return { ...state, phase: "error", errorMessage: action.message };
        default: {
            const exhaustive: never = action;
            return exhaustive;
        }
    }
}

/** Client-side msTaken cap: only ever downgrades toward no-glint (spec §5.6). */
export const MS_TAKEN_CAP = 120_000;

export interface VoiceReviewApi {
    state: VoiceReviewState;
    loadNext(): Promise<void>;
    startListening(): Promise<void>;
    stopAndGrade(): Promise<void>;
    submitTyped(text: string): Promise<void>;
    sayIdk(): Promise<void>;
    appeal(): void;
    advance(): Promise<void>;
    cancel(): void;
}

export function useVoiceReview(opts: {
    scopeKey: string;
    preferVariant?: boolean;
    singleCard?: boolean;
    onGraded(result: VoiceGradeResult, msTaken: number): void;
    onEmpty(counts: { answered: number }): void;
    onNoVariant?(): void;
}): VoiceReviewApi {
    const { preferVariant, singleCard, onGraded, onEmpty, onNoVariant } = opts;
    const [state, dispatch] = useReducer(voiceReviewReducer, INITIAL_VOICE_STATE);
    const recorder = useRef(new MicRecorder());
    const promptShownAt = useRef(0);
    const answered = useRef(0);
    const recoveredFromError = useRef(false);
    // The card grading targets — a ref so async grade() never closes over a stale render.
    const currentCard = useRef<VoiceNextCard | null>(null);

    const loadNext = useCallback(async (): Promise<void> => {
        dispatch({ type: "loading" });
        try {
            const res = await fetchNextVoiceCard({ preferVariant });
            switch (res.kind) {
                case "disabled":
                case "unavailable":
                    currentCard.current = null;
                    dispatch({ type: "terminal", phase: "classic" });
                    return;
                case "done":
                    currentCard.current = null;
                    dispatch({ type: "terminal", phase: "empty" });
                    onEmpty({ answered: answered.current });
                    return;
                case "noVariant":
                    currentCard.current = null;
                    dispatch({ type: "terminal", phase: "noVariant" });
                    onNoVariant?.();
                    return;
                case "card":
                    currentCard.current = res.card;
                    promptShownAt.current = Date.now();
                    dispatch({ type: "card", card: res.card, stt: res.stt });
                    return;
                default: {
                    const exhaustive: never = res;
                    throw new Error(`unhandled next result ${String(exhaustive)}`);
                }
            }
        } catch (err) {
            dispatch({
                type: "error",
                message: err instanceof Error ? err.message : "voice review failed",
            });
        }
    }, [preferVariant, onEmpty, onNoVariant]);

    const grade = useCallback(
        async (req: {
            transcript?: string;
            audioBase64?: string;
            audioMime?: string;
            idk?: boolean;
        }): Promise<void> => {
            const card = currentCard.current;
            if (!card) {
                return;
            }
            // No artificial delay here: the Keeper's reply opener starts crawling the moment
            // this dispatches, and the "…" typing dots hold the beat until the grade lands.
            dispatch({ type: "thinking" });
            const msTaken = Math.min(Date.now() - promptShownAt.current, MS_TAKEN_CAP);
            try {
                const out = await gradeVoiceAnswer({
                    cardId: card.cardId,
                    msTaken,
                    ...req,
                });
                switch (out.kind) {
                    case "graded":
                        answered.current += 1;
                        recoveredFromError.current = false;
                        dispatch({ type: "result", result: out.result });
                        onGraded(out.result, msTaken);
                        return;
                    case "rePrompt":
                        promptShownAt.current = Date.now();
                        dispatch({
                            type: "rePrompt",
                            keeperLine: out.keeperLine,
                            hint: out.hint,
                        });
                        return;
                    case "sttError":
                        dispatch({
                            type: "micError",
                            message: `${out.message} — try typing your answer instead.`,
                        });
                        return;
                    case "error":
                        // e.g. not_served after a server restart — recover ONCE by reloading.
                        if (!recoveredFromError.current) {
                            recoveredFromError.current = true;
                            await loadNext();
                        } else {
                            dispatch({ type: "error", message: out.message });
                        }
                        return;
                    default: {
                        const exhaustive: never = out;
                        throw new Error(`unhandled grade outcome ${String(exhaustive)}`);
                    }
                }
            } catch (err) {
                dispatch({
                    type: "error",
                    message: err instanceof Error ? err.message : "grading failed",
                });
            }
        },
        [onGraded, loadNext],
    );

    const startListening = useCallback(async (): Promise<void> => {
        try {
            await recorder.current.start();
            dispatch({ type: "listening" });
        } catch {
            dispatch({
                type: "micError",
                message: "The microphone could not start — type your answer instead.",
            });
        }
    }, []);

    const stopAndGrade = useCallback(async (): Promise<void> => {
        try {
            const rec = await recorder.current.stop();
            await grade({ audioBase64: rec.base64, audioMime: rec.mime });
        } catch {
            dispatch({
                type: "micError",
                message: "Nothing was recorded — try again or type your answer.",
            });
        }
    }, [grade]);

    const submitTyped = useCallback(
        async (text: string): Promise<void> => {
            const trimmed = text.trim();
            if (!trimmed) {
                return;
            }
            await grade({ transcript: trimmed });
        },
        [grade],
    );

    const sayIdk = useCallback(async (): Promise<void> => {
        await grade({ idk: true });
    }, [grade]);

    const appeal = useCallback((): void => {
        // "That's not what I said": never a self-upgrade — the same card is re-asked and the
        // server's attempt ladder grades the retry (voice spec §3.4).
        promptShownAt.current = Date.now();
        dispatch({ type: "backToPrompt" });
    }, []);

    const advance = useCallback(async (): Promise<void> => {
        if (singleCard) {
            onEmpty({ answered: answered.current });
            return;
        }
        await loadNext();
    }, [singleCard, onEmpty, loadNext]);

    const cancel = useCallback((): void => {
        recorder.current.cancel();
    }, []);

    return useMemo(
        () => ({
            state,
            loadNext,
            startListening,
            stopAndGrade,
            submitTyped,
            sayIdk,
            appeal,
            advance,
            cancel,
        }),
        [
            state,
            loadNext,
            startListening,
            stopAndGrade,
            submitTyped,
            sayIdk,
            appeal,
            advance,
            cancel,
        ],
    );
}
