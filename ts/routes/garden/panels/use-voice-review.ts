// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the voice-Keeper session state machine (voice-Keeper spec §3). A
// framework-agnostic controller (VoiceSession — unit-tested without React) drives the
// phases loading -> prompt -> (listening) -> thinking -> result | rePrompt, with honest
// terminal states (classic fallback, empty, noVariant, error). All server trust lives
// server-side; this layer only sequences UI and measures msTaken. The React hook
// (useVoiceReview) is a thin subscription wrapper.
import { useEffect, useRef, useState } from "react";

import {
    fetchNextVoiceCard,
    gradeVoiceAnswer,
    type SttInfo,
    type VoiceGradeOutcome,
    type VoiceGradeResult,
    type VoiceNextCard,
    type VoiceNextResult,
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

export interface VoiceSessionOptions {
    preferVariant?: boolean;
    /** In single-card mode (the ProveIt reworded check), advance() ends the session. */
    singleCard?: boolean;
    onGraded(result: VoiceGradeResult, msTaken: number): void;
    onEmpty(counts: { answered: number }): void;
    onNoVariant?(): void;
}

interface VoiceApi {
    fetchNext(opts?: { preferVariant?: boolean }): Promise<VoiceNextResult>;
    grade(req: {
        cardId: number;
        idk?: boolean;
        msTaken?: number;
        transcript?: string;
        audioBase64?: string;
        audioMime?: string;
    }): Promise<VoiceGradeOutcome>;
}

const REAL_API: VoiceApi = {
    fetchNext: fetchNextVoiceCard,
    grade: gradeVoiceAnswer,
};

const INITIAL: VoiceReviewState = {
    phase: "loading",
    card: null,
    stt: { available: false, local: false, hosted: false },
    result: null,
    rePrompt: null,
    micError: "",
    answered: 0,
    errorMessage: "",
};

export const MS_TAKEN_CAP = 120_000;

export class VoiceSession {
    state: VoiceReviewState = INITIAL;
    private opts: VoiceSessionOptions;
    private api: VoiceApi;
    private recorder: MicRecorder;
    private listener: (() => void) | null = null;
    private promptShownAt = 0;
    private recoveredFromError = false;
    private now: () => number;

    constructor(
        opts: VoiceSessionOptions,
        deps?: { api?: VoiceApi; recorder?: MicRecorder; now?: () => number },
    ) {
        this.opts = opts;
        this.api = deps?.api ?? REAL_API;
        this.recorder = deps?.recorder ?? new MicRecorder();
        this.now = deps?.now ?? (() => Date.now());
    }

    subscribe(listener: () => void): () => void {
        this.listener = listener;
        return () => {
            this.listener = null;
        };
    }

    setOptions(opts: VoiceSessionOptions): void {
        this.opts = opts;
    }

    private set(partial: Partial<VoiceReviewState>): void {
        this.state = { ...this.state, ...partial };
        this.listener?.();
    }

    /** Answerable = the student may speak/type right now (prompt or the re-prompt beat). */
    get answerable(): boolean {
        return this.state.phase === "prompt" || this.state.phase === "rePrompt";
    }

    async loadNext(): Promise<void> {
        this.set({ phase: "loading", result: null, rePrompt: null, micError: "" });
        try {
            const res = await this.api.fetchNext({
                preferVariant: this.opts.preferVariant,
            });
            switch (res.kind) {
                case "disabled":
                case "unavailable":
                    // Escape hatch / no backend: the caller renders the classic reviewer.
                    this.set({ phase: "classic", card: null });
                    return;
                case "done":
                    this.set({ phase: "empty", card: null });
                    this.opts.onEmpty({ answered: this.state.answered });
                    return;
                case "noVariant":
                    this.set({ phase: "noVariant", card: null });
                    this.opts.onNoVariant?.();
                    return;
                case "card":
                    this.promptShownAt = this.now();
                    this.set({
                        phase: "prompt",
                        card: res.card,
                        stt: res.stt,
                        result: null,
                        rePrompt: null,
                        micError: "",
                    });
            }
        } catch (err) {
            this.set({
                phase: "error",
                errorMessage: err instanceof Error ? err.message : "voice review failed",
            });
        }
    }

    private async gradeWith(req: {
        transcript?: string;
        audioBase64?: string;
        audioMime?: string;
        idk?: boolean;
    }): Promise<void> {
        const card = this.state.card;
        if (!card || !(this.answerable || this.state.phase === "listening")) {
            return;
        }
        this.set({ phase: "thinking" });
        const msTaken = Math.min(this.now() - this.promptShownAt, MS_TAKEN_CAP);
        try {
            const out = await this.api.grade({ cardId: card.cardId, msTaken, ...req });
            switch (out.kind) {
                case "graded":
                    this.recoveredFromError = false;
                    this.set({
                        phase: "result",
                        result: out.result,
                        answered: this.state.answered + 1,
                    });
                    this.opts.onGraded(out.result, msTaken);
                    return;
                case "rePrompt":
                    // §13 ask-again ladder: same card, one more chance, no commit yet.
                    this.promptShownAt = this.now();
                    this.set({
                        phase: "rePrompt",
                        rePrompt: { keeperLine: out.keeperLine, hint: out.hint },
                    });
                    return;
                case "sttError":
                    this.set({
                        phase: "prompt",
                        micError: `${out.message} — try typing your answer instead.`,
                    });
                    return;
                case "error":
                    // e.g. not_served after a mediasrv restart — recover ONCE by reloading.
                    if (!this.recoveredFromError) {
                        this.recoveredFromError = true;
                        await this.loadNext();
                    } else {
                        this.set({ phase: "error", errorMessage: out.message });
                    }
            }
        } catch (err) {
            this.set({
                phase: "error",
                errorMessage: err instanceof Error ? err.message : "grading failed",
            });
        }
    }

    async startListening(): Promise<void> {
        if (!this.answerable) {
            return;
        }
        try {
            await this.recorder.start();
            this.set({ phase: "listening", micError: "" });
        } catch {
            this.set({
                phase: "prompt",
                micError: "The microphone could not start — type your answer instead.",
            });
        }
    }

    async stopAndGrade(): Promise<void> {
        if (this.state.phase !== "listening") {
            return;
        }
        try {
            const rec = await this.recorder.stop();
            await this.gradeWith({ audioBase64: rec.base64, audioMime: rec.mime });
        } catch {
            this.set({
                phase: "prompt",
                micError: "Nothing was recorded — try again or type your answer.",
            });
        }
    }

    async submitTyped(text: string): Promise<void> {
        const trimmed = text.trim();
        if (!trimmed) {
            return;
        }
        await this.gradeWith({ transcript: trimmed });
    }

    async sayIdk(): Promise<void> {
        await this.gradeWith({ idk: true });
    }

    /** "That's not what I said": never a self-upgrade — the same card is re-asked and the
     * server's attempt ladder grades the retry (spec §3.4). */
    appeal(): void {
        if (this.state.phase !== "result") {
            return;
        }
        this.promptShownAt = this.now();
        this.set({ phase: "prompt", result: null });
    }

    async advance(): Promise<void> {
        if (this.opts.singleCard) {
            this.opts.onEmpty({ answered: this.state.answered });
            return;
        }
        await this.loadNext();
    }

    cancel(): void {
        this.recorder.cancel();
    }
}

export interface VoiceReviewApi {
    state: VoiceReviewState;
    answerable: boolean;
    loadNext(): Promise<void>;
    startListening(): Promise<void>;
    stopAndGrade(): Promise<void>;
    submitTyped(text: string): Promise<void>;
    sayIdk(): Promise<void>;
    appeal(): void;
    advance(): Promise<void>;
    cancel(): void;
}

export function useVoiceReview(
    opts: VoiceSessionOptions & { scopeKey: string },
): VoiceReviewApi {
    const [, bump] = useState(0);
    const session = useRef<VoiceSession | null>(null);
    if (session.current === null) {
        session.current = new VoiceSession(opts);
    }
    // Keep the latest callbacks without re-creating the session.
    session.current.setOptions(opts);

    useEffect(() => {
        const s = session.current!;
        const unsubscribe = s.subscribe(() => bump((n) => n + 1));
        void s.loadNext();
        return () => {
            s.cancel();
            unsubscribe();
        };
        // A new scope (deck) means a fresh session load; callbacks are handled above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opts.scopeKey]);

    const s = session.current;
    return {
        state: s.state,
        answerable: s.answerable,
        loadNext: () => s.loadNext(),
        startListening: () => s.startListening(),
        stopAndGrade: () => s.stopAndGrade(),
        submitTyped: (text: string) => s.submitTyped(text),
        sayIdk: () => s.sayIdk(),
        appeal: () => s.appeal(),
        advance: () => s.advance(),
        cancel: () => s.cancel(),
    };
}
