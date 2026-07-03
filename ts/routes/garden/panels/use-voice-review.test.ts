// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the voice-Keeper session machine (spec §3) — phase transitions,
// callback contract, msTaken cap, appeal, ask-again, honest error surfaces. Tests the
// framework-agnostic VoiceSession directly (no React needed).
import { describe, expect, it, vi } from "vitest";

import type { VoiceGradeOutcome, VoiceGradeResult, VoiceNextResult } from "./voice-api";
import { MS_TAKEN_CAP, VoiceSession } from "./use-voice-review";

const CARD: VoiceNextResult = {
    kind: "card",
    stt: { available: true, local: true, hosted: false },
    card: {
        cardId: 42,
        nodeId: "MCAT::P-S::8A",
        keeperLine: "What is self-concept?",
        isFreshVariant: false,
        counts: { new: 1, learning: 0, review: 0 },
    },
};

const GOOD_RESULT: VoiceGradeResult = {
    bucket: "good",
    score: 93,
    method: "lexical",
    sentinel: null,
    transcript: "self concept",
    correctAnswer: "Self-concept",
    keyPointsHit: [],
    keyPointsMissed: [],
    rationale: "",
    rating: 2,
    recovered: false,
    bloomed: false,
    isFreshVariant: false,
};

const GRADED: VoiceGradeOutcome = { kind: "graded", result: GOOD_RESULT };

class FakeRecorder {
    started = 0;
    stopped = 0;
    cancelled = 0;
    failStart = false;
    async start(): Promise<void> {
        if (this.failStart) {
            throw new Error("mic denied");
        }
        this.started += 1;
    }
    async stop(): Promise<{ base64: string; mime: string }> {
        this.stopped += 1;
        return { base64: "QUJD", mime: "audio/webm" };
    }
    cancel(): void {
        this.cancelled += 1;
    }
    get active(): boolean {
        return this.started > this.stopped;
    }
}

function makeSession(over: {
    fetchNext?: VoiceNextResult | VoiceNextResult[];
    grade?: VoiceGradeOutcome | VoiceGradeOutcome[];
    singleCard?: boolean;
    preferVariant?: boolean;
    now?: () => number;
}) {
    const onGraded = vi.fn();
    const onEmpty = vi.fn();
    const onNoVariant = vi.fn();
    const fetchQueue = Array.isArray(over.fetchNext)
        ? [...over.fetchNext]
        : [over.fetchNext ?? CARD];
    const gradeQueue = Array.isArray(over.grade) ? [...over.grade] : [over.grade ?? GRADED];
    const fetchNext = vi.fn(async () => fetchQueue.length > 1 ? fetchQueue.shift()! : fetchQueue[0]);
    const grade = vi.fn(async () => gradeQueue.length > 1 ? gradeQueue.shift()! : gradeQueue[0]);
    const recorder = new FakeRecorder();
    const session = new VoiceSession(
        {
            singleCard: over.singleCard,
            preferVariant: over.preferVariant,
            onGraded,
            onEmpty,
            onNoVariant,
        },
        {
            api: { fetchNext, grade },
            recorder: recorder as never,
            now: over.now,
        },
    );
    return { session, onGraded, onEmpty, onNoVariant, fetchNext, grade, recorder };
}

describe("VoiceSession", () => {
    it("loads a card into prompt", async () => {
        const { session } = makeSession({});
        await session.loadNext();
        expect(session.state.phase).toBe("prompt");
        expect(session.state.card?.cardId).toBe(42);
        expect(session.answerable).toBe(true);
    });

    it("falls back to classic when the escape hatch is set", async () => {
        const { session } = makeSession({ fetchNext: { kind: "disabled" } });
        await session.loadNext();
        expect(session.state.phase).toBe("classic");
    });

    it("empty queue fires onEmpty with the answered count", async () => {
        const { session, onEmpty } = makeSession({ fetchNext: { kind: "done" } });
        await session.loadNext();
        expect(session.state.phase).toBe("empty");
        expect(onEmpty).toHaveBeenCalledWith({ answered: 0 });
    });

    it("grades a typed answer and fires onGraded with msTaken", async () => {
        let t = 1000;
        const { session, onGraded } = makeSession({ now: () => t });
        await session.loadNext();
        t = 4000; // 3s thinking time
        await session.submitTyped("self concept");
        expect(session.state.phase).toBe("result");
        expect(session.state.answered).toBe(1);
        expect(onGraded).toHaveBeenCalledWith(
            expect.objectContaining({ bucket: "good" }),
            3000,
        );
    });

    it("caps msTaken at 120s (glint can only be lost, never gamed)", async () => {
        let t = 0;
        const { session, grade } = makeSession({ now: () => t });
        await session.loadNext();
        t = 10 * 60 * 1000; // ten minutes later
        await session.submitTyped("x");
        expect(grade).toHaveBeenCalledWith(
            expect.objectContaining({ msTaken: MS_TAKEN_CAP }),
        );
    });

    it("empty typed input is a no-op (never grades whitespace)", async () => {
        const { session, grade } = makeSession({});
        await session.loadNext();
        await session.submitTyped("   ");
        expect(grade).not.toHaveBeenCalled();
        expect(session.state.phase).toBe("prompt");
    });

    it("handles a re-prompt without firing onGraded, then grades attempt 2", async () => {
        const { session, onGraded } = makeSession({
            grade: [
                {
                    kind: "rePrompt",
                    keeperLine: "again",
                    hint: "core idea?",
                    transcript: "x",
                    score: 50,
                },
                GRADED,
            ],
        });
        await session.loadNext();
        await session.submitTyped("partial");
        expect(session.state.phase).toBe("rePrompt");
        expect(session.state.rePrompt?.hint).toBe("core idea?");
        expect(onGraded).not.toHaveBeenCalled();
        expect(session.answerable).toBe(true); // the re-prompt accepts answers
        await session.submitTyped("better answer");
        expect(session.state.phase).toBe("result");
        expect(onGraded).toHaveBeenCalledTimes(1);
    });

    it("surfaces stt errors back on the prompt with micError set", async () => {
        const { session } = makeSession({
            grade: { kind: "sttError", message: "local STT failed" },
        });
        await session.loadNext();
        await session.startListening();
        await session.stopAndGrade();
        expect(session.state.phase).toBe("prompt");
        expect(session.state.micError).toContain("local STT failed");
        expect(session.state.micError).toContain("typing");
    });

    it("mic denial falls back to prompt with a typed steer, never a dead end", async () => {
        const { session, recorder } = makeSession({});
        recorder.failStart = true;
        await session.loadNext();
        await session.startListening();
        expect(session.state.phase).toBe("prompt");
        expect(session.state.micError).toContain("type your answer");
    });

    it("mic stop releases the recorder and grades the audio", async () => {
        const { session, grade, recorder } = makeSession({});
        await session.loadNext();
        await session.startListening();
        expect(session.state.phase).toBe("listening");
        await session.stopAndGrade();
        expect(recorder.stopped).toBe(1);
        expect(grade).toHaveBeenCalledWith(
            expect.objectContaining({ audioBase64: "QUJD", audioMime: "audio/webm" }),
        );
    });

    it("recovers ONCE from a server error (not_served) by reloading", async () => {
        const { session, fetchNext } = makeSession({
            grade: { kind: "error", message: "not_served" },
        });
        await session.loadNext();
        await session.submitTyped("x");
        // recovered: reloaded a fresh card instead of dying
        expect(session.state.phase).toBe("prompt");
        expect(fetchNext).toHaveBeenCalledTimes(2);
        await session.submitTyped("x");
        // second failure surfaces honestly
        expect(session.state.phase).toBe("error");
        expect(session.state.errorMessage).toBe("not_served");
    });

    it("sayIdk grades with the idk flag", async () => {
        const { session, grade } = makeSession({});
        await session.loadNext();
        await session.sayIdk();
        expect(grade).toHaveBeenCalledWith(expect.objectContaining({ idk: true }));
    });

    it("appeal returns to the prompt for a re-answer (never a self-upgrade)", async () => {
        const { session } = makeSession({});
        await session.loadNext();
        await session.submitTyped("self concept");
        expect(session.state.phase).toBe("result");
        session.appeal();
        expect(session.state.phase).toBe("prompt");
        expect(session.state.result).toBeNull();
    });

    it("advance in singleCard mode calls onEmpty, not loadNext", async () => {
        const { session, onEmpty, fetchNext } = makeSession({ singleCard: true });
        await session.loadNext();
        await session.submitTyped("self concept");
        await session.advance();
        expect(onEmpty).toHaveBeenCalledWith({ answered: 1 });
        expect(fetchNext).toHaveBeenCalledTimes(1);
    });

    it("advance in session mode loads the next card", async () => {
        const { session, fetchNext } = makeSession({});
        await session.loadNext();
        await session.submitTyped("self concept");
        await session.advance();
        expect(fetchNext).toHaveBeenCalledTimes(2);
        expect(session.state.phase).toBe("prompt");
    });

    it("reports noVariant via callback (honest skip for the bloom beat)", async () => {
        const { session, onNoVariant } = makeSession({
            fetchNext: { kind: "noVariant" },
            preferVariant: true,
        });
        await session.loadNext();
        expect(session.state.phase).toBe("noVariant");
        expect(onNoVariant).toHaveBeenCalled();
    });

    it("passes preferVariant through to the API", async () => {
        const { session, fetchNext } = makeSession({ preferVariant: true });
        await session.loadNext();
        expect(fetchNext).toHaveBeenCalledWith({ preferVariant: true });
    });

    it("cancel releases the mic", async () => {
        const { session, recorder } = makeSession({});
        await session.loadNext();
        session.cancel();
        expect(recorder.cancelled).toBe(1);
    });
});
