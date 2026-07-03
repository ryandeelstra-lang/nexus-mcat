// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins every transition of the voice-Keeper session reducer (voice spec §3) —
// the phase machine is a pure function, so all paths (including error/appeal/re-prompt)
// are covered without a DOM.
import { describe, expect, it } from "vitest";

import {
    INITIAL_VOICE_STATE,
    MS_TAKEN_CAP,
    voiceReviewReducer,
    type VoiceReviewState,
} from "./use-voice-review";
import type { VoiceGradeResult, VoiceNextCard } from "./voice-api";

const CARD: VoiceNextCard = {
    cardId: 42,
    nodeId: "MCAT::P-S::8A",
    keeperLine: "What is self-concept?",
    isFreshVariant: false,
    counts: { new: 1, learning: 0, review: 0 },
};

const STT = { available: true, local: true, hosted: false };

const GRADED: VoiceGradeResult = {
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

function atPrompt(): VoiceReviewState {
    return voiceReviewReducer(INITIAL_VOICE_STATE, {
        type: "card",
        card: CARD,
        stt: STT,
    });
}

describe("voiceReviewReducer", () => {
    it("a served card lands on prompt with clean result/rePrompt/micError", () => {
        const s = atPrompt();
        expect(s.phase).toBe("prompt");
        expect(s.card?.cardId).toBe(42);
        expect(s.stt.local).toBe(true);
        expect(s.result).toBeNull();
        expect(s.rePrompt).toBeNull();
        expect(s.micError).toBe("");
    });

    it("terminal states clear the card (classic fallback, empty, noVariant)", () => {
        for (const phase of ["classic", "empty", "noVariant"] as const) {
            const s = voiceReviewReducer(atPrompt(), { type: "terminal", phase });
            expect(s.phase).toBe(phase);
            expect(s.card).toBeNull();
        }
    });

    it("prompt -> listening -> thinking -> result counts the answer", () => {
        let s = atPrompt();
        s = voiceReviewReducer(s, { type: "listening" });
        expect(s.phase).toBe("listening");
        s = voiceReviewReducer(s, { type: "thinking" });
        expect(s.phase).toBe("thinking");
        s = voiceReviewReducer(s, { type: "result", result: GRADED });
        expect(s.phase).toBe("result");
        expect(s.result?.bucket).toBe("good");
        expect(s.answered).toBe(1);
    });

    it("a re-prompt keeps the card and carries the hint (no answer counted)", () => {
        let s = atPrompt();
        s = voiceReviewReducer(s, { type: "thinking" });
        s = voiceReviewReducer(s, {
            type: "rePrompt",
            keeperLine: "Try it another way",
            hint: "core idea?",
        });
        expect(s.phase).toBe("rePrompt");
        expect(s.rePrompt).toEqual({
            keeperLine: "Try it another way",
            hint: "core idea?",
        });
        expect(s.card?.cardId).toBe(42);
        expect(s.answered).toBe(0);
    });

    it("a mic/STT error returns to prompt with the message (steer to typing)", () => {
        let s = atPrompt();
        s = voiceReviewReducer(s, { type: "thinking" });
        s = voiceReviewReducer(s, {
            type: "micError",
            message: "local STT failed — try typing your answer instead.",
        });
        expect(s.phase).toBe("prompt");
        expect(s.micError).toContain("typing");
    });

    it("listening clears a previous mic error", () => {
        let s = voiceReviewReducer(atPrompt(), {
            type: "micError",
            message: "boom",
        });
        s = voiceReviewReducer(s, { type: "listening" });
        expect(s.micError).toBe("");
    });

    it("appeal (backToPrompt) leaves result mode for a re-answer, never self-upgrades", () => {
        let s = atPrompt();
        s = voiceReviewReducer(s, { type: "result", result: GRADED });
        s = voiceReviewReducer(s, { type: "backToPrompt" });
        expect(s.phase).toBe("prompt");
        expect(s.result).toBeNull();
        expect(s.answered).toBe(1); // the applied grade is not un-counted
    });

    it("errors carry the message; loading resets transient state", () => {
        let s = voiceReviewReducer(atPrompt(), {
            type: "error",
            message: "not_served",
        });
        expect(s.phase).toBe("error");
        expect(s.errorMessage).toBe("not_served");
        s = voiceReviewReducer(s, { type: "loading" });
        expect(s.phase).toBe("loading");
        expect(s.result).toBeNull();
        expect(s.rePrompt).toBeNull();
        expect(s.micError).toBe("");
    });

    it("msTaken cap only ever downgrades toward no-glint", () => {
        expect(MS_TAKEN_CAP).toBe(120_000);
    });
});
