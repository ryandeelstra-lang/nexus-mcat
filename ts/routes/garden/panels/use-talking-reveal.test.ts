// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the Keeper's human word-cadence primitives — the ~70ms±jitter pause
// contract, punctuation breaths, the streamed reply composition (opener → answer → why →
// verdict), and the append-aware word slice the crawl renders.
import { describe, expect, it } from "vitest";

import {
    CLAUSE_PAUSE_MULT,
    composeKeeperReply,
    delayAfterWord,
    pickOpener,
    REPLY_OPENERS,
    revealWords,
    SENTENCE_PAUSE_MULT,
    verdictFor,
    WORD_BASE_MS,
    WORD_JITTER_MS,
    wordsOf,
} from "./use-talking-reveal";

describe("delayAfterWord", () => {
    it("holds the talking-speed contract: ~70ms with ±jitter around it", () => {
        expect(WORD_BASE_MS).toBe(70);
        expect(delayAfterWord("word", 0.5)).toBe(WORD_BASE_MS);
        expect(delayAfterWord("word", 1)).toBe(WORD_BASE_MS + WORD_JITTER_MS);
        expect(delayAfterWord("word", 0)).toBe(WORD_BASE_MS - WORD_JITTER_MS);
    });

    it("varies randomly between words (never a metronome)", () => {
        const a = delayAfterWord("word", 0.1);
        const b = delayAfterWord("word", 0.9);
        expect(a).not.toBe(b);
    });

    it("breathes at punctuation: sentence ends pause longest, clauses in between", () => {
        const plain = delayAfterWord("word", 0.5);
        const clause = delayAfterWord("word,", 0.5);
        const sentence = delayAfterWord("word.", 0.5);
        expect(clause).toBe(Math.round(plain * CLAUSE_PAUSE_MULT));
        expect(sentence).toBe(Math.round(plain * SENTENCE_PAUSE_MULT));
        expect(sentence).toBeGreaterThan(clause);
        // trailing quotes/brackets don't hide the breath
        expect(delayAfterWord("done.\"", 0.5)).toBe(sentence);
    });

    it("never goes below the floor", () => {
        expect(delayAfterWord("word", 0, 24, 24)).toBeGreaterThanOrEqual(24);
    });
});

describe("revealWords / wordsOf", () => {
    it("reveals whole words and clamps at the end", () => {
        expect(revealWords("one two three", 0)).toBe("");
        expect(revealWords("one two three", 2)).toBe("one two");
        expect(revealWords("one two three", 99)).toBe("one two three");
    });

    it("never goes negative and tolerates empty text", () => {
        expect(revealWords("one two", -3)).toBe("");
        expect(revealWords("", 5)).toBe("");
    });

    it("keeps its word count stable when the text GROWS (streamed reply)", () => {
        const opener = "Hmm… let me look at that.";
        const grown = `${opener} The answer: mitochondria`;
        const shownBefore = revealWords(opener, 3);
        const shownAfter = revealWords(grown, 3);
        expect(shownAfter).toBe(shownBefore); // the crawl never jumps back or re-shuffles
        expect(wordsOf(grown).slice(0, wordsOf(opener).length).join(" ")).toBe(
            wordsOf(opener).join(" "),
        );
    });
});

describe("composeKeeperReply", () => {
    it("speaks opener, then the answer, then the why, then the verdict", () => {
        expect(
            composeKeeperReply({
                opener: "Okay…",
                correctAnswer: "a phosphate group",
                rationale: "It is hydrophilic.",
                verdictHeadline: "You got it!",
            }),
        ).toBe("Okay… The answer: a phosphate group — It is hydrophilic. You got it!");
    });

    it("omits missing parts and collapses whitespace", () => {
        expect(
            composeKeeperReply({
                opener: "Mm — let's see.",
                correctAnswer: "the  mitochondria",
                rationale: "  ",
                verdictHeadline: "Maybe next time.",
            }),
        ).toBe("Mm — let's see. The answer: the mitochondria Maybe next time.");
    });

    it("survives a missing answer", () => {
        expect(
            composeKeeperReply({
                opener: "",
                correctAnswer: "",
                rationale: "close",
                verdictHeadline: "",
            }),
        ).toBe("close");
    });
});

describe("pickOpener", () => {
    it("is deterministic per seed and always a known opener", () => {
        const a = pickOpener("card-42:attempt-1");
        expect(a).toBe(pickOpener("card-42:attempt-1"));
        expect(REPLY_OPENERS).toContain(a);
    });

    it("spreads across the opener pool", () => {
        const picks = new Set(
            Array.from({ length: 40 }, (_, i) => pickOpener(`seed-${i}`)),
        );
        expect(picks.size).toBeGreaterThan(1);
    });
});

describe("verdictFor", () => {
    it("passes good and okay, fails the rest", () => {
        expect(verdictFor("good").passed).toBe(true);
        expect(verdictFor("okay").passed).toBe(true);
        expect(verdictFor("dont_know").passed).toBe(false);
        expect(verdictFor("ask_again").passed).toBe(false);
    });

    it("speaks the user's own words for a terminal result", () => {
        expect(verdictFor("good").headline).toBe("You got it!");
        expect(verdictFor("dont_know").headline).toBe("Maybe next time.");
    });
});
