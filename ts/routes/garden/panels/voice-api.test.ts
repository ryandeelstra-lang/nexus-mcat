// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the voice-Keeper client contract (voice spec §4) — payload mapping,
// the escape hatch, honest error surfaces, and the ONE rating conversion (1-4 -> 0-3).
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchNextVoiceCard, fetchVoiceReveal, gradeVoiceAnswer, toClientRating } from "./voice-api";

function mockFetchOnce(payload: unknown): void {
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    );
}

afterEach(() => vi.unstubAllGlobals());

describe("toClientRating", () => {
    it("converts server v3 ease 1-4 to the client 0-3 enum", () => {
        expect(toClientRating(1)).toBe(0); // AGAIN
        expect(toClientRating(2)).toBe(1); // HARD
        expect(toClientRating(3)).toBe(2); // GOOD
        expect(toClientRating(4)).toBe(3); // EASY
    });
});

describe("fetchNextVoiceCard", () => {
    it("maps a served card payload", async () => {
        mockFetchOnce({
            available: true,
            enabled: true,
            done: false,
            stt: { available: true, local: true, hosted: false },
            card_id: 42,
            node_id: "MCAT::P-S::8A",
            keeper_line: "What is self-concept?",
            is_fresh_variant: true,
            counts: { new: 20, learning: 5, review: 0 },
        });
        const res = await fetchNextVoiceCard();
        expect(res.kind).toBe("card");
        if (res.kind === "card") {
            expect(res.card.cardId).toBe(42);
            expect(res.card.isFreshVariant).toBe(true);
            expect(res.card.counts).toEqual({ new: 20, learning: 5, review: 0 });
            expect(res.stt.local).toBe(true);
        }
    });

    it("maps the escape hatch to disabled", async () => {
        mockFetchOnce({ available: true, enabled: false });
        expect((await fetchNextVoiceCard()).kind).toBe("disabled");
    });

    it("maps unavailable, done and noVariant", async () => {
        mockFetchOnce({ available: false });
        expect((await fetchNextVoiceCard()).kind).toBe("unavailable");
        mockFetchOnce({
            available: true,
            enabled: true,
            done: true,
            stt: { available: false, local: false, hosted: false },
        });
        expect((await fetchNextVoiceCard()).kind).toBe("done");
        mockFetchOnce({
            available: true,
            enabled: true,
            no_variant: true,
            stt: { available: false, local: false, hosted: false },
        });
        expect((await fetchNextVoiceCard({ preferVariant: true })).kind).toBe(
            "noVariant",
        );
    });
});

describe("fetchVoiceReveal", () => {
    it("maps a revealed answer", async () => {
        mockFetchOnce({ available: true, revealed: true, correct_answer: "Self-concept" });
        expect(await fetchVoiceReveal(42)).toBe("Self-concept");
    });

    it("is best-effort: unavailable, unrevealed, empty, and network errors all yield null", async () => {
        mockFetchOnce({ available: false });
        expect(await fetchVoiceReveal(42)).toBeNull();
        mockFetchOnce({ available: true, revealed: false, error: "not_served" });
        expect(await fetchVoiceReveal(42)).toBeNull();
        mockFetchOnce({ available: true, revealed: true, correct_answer: "  " });
        expect(await fetchVoiceReveal(42)).toBeNull();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
        expect(await fetchVoiceReveal(42)).toBeNull();
    });
});

describe("gradeVoiceAnswer", () => {
    it("maps a terminal grade with the rating converted", async () => {
        mockFetchOnce({
            available: true,
            applied: true,
            bucket: "good",
            score: 93.5,
            method: "semantic",
            sentinel: null,
            transcript: "self concept",
            correct_answer: "Self-concept — ...",
            key_points_hit: ["self-concept"],
            key_points_missed: [],
            rationale: "Nailed it.",
            rating: 3,
            recovered: false,
            bloomed: true,
            is_fresh_variant: true,
        });
        const out = await gradeVoiceAnswer({ cardId: 42, transcript: "self concept" });
        expect(out.kind).toBe("graded");
        if (out.kind === "graded") {
            expect(out.result.rating).toBe(2); // server GOOD(3) -> client GOOD(2)
            expect(out.result.bloomed).toBe(true);
            expect(out.result.sentinel).toBeNull();
        }
    });

    it("maps a re-prompt without a terminal grade", async () => {
        mockFetchOnce({
            available: true,
            applied: false,
            bucket: "ask_again",
            score: 55,
            method: "lexical",
            sentinel: null,
            transcript: "partial",
            rationale: "",
            re_prompt: { keeper_line: "Try again", hint: "core idea?", attempt: 2 },
        });
        const out = await gradeVoiceAnswer({ cardId: 42, transcript: "partial" });
        expect(out.kind).toBe("rePrompt");
        if (out.kind === "rePrompt") {
            expect(out.hint).toBe("core idea?");
            expect(out.score).toBe(55);
        }
    });

    it("maps stt errors and server errors honestly", async () => {
        mockFetchOnce({
            available: true,
            applied: false,
            stt_error: "local STT failed: x",
        });
        expect((await gradeVoiceAnswer({ cardId: 42, audioBase64: "x" })).kind).toBe(
            "sttError",
        );
        mockFetchOnce({ available: true, applied: false, error: "not_served" });
        expect((await gradeVoiceAnswer({ cardId: 42, transcript: "hi" })).kind).toBe(
            "error",
        );
        mockFetchOnce({ available: false });
        expect((await gradeVoiceAnswer({ cardId: 42, transcript: "hi" })).kind).toBe(
            "error",
        );
    });
});
