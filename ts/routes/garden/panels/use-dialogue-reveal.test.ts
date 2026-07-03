// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the streamed graded-reply pure helpers (dialogue-UX plan §4).
import { describe, expect, it } from "vitest";

import { composeKeeperReply, verdictFor, wordCrawlStep } from "./use-dialogue-reveal";

describe("composeKeeperReply", () => {
    it("leads with the answer, then the why", () => {
        expect(
            composeKeeperReply({
                correctAnswer: "a phosphate group",
                rationale: "It is hydrophilic.",
            }),
        ).toBe("The answer: a phosphate group — It is hydrophilic.");
    });

    it("omits the why when absent and collapses whitespace", () => {
        expect(
            composeKeeperReply({ correctAnswer: "the  mitochondria", rationale: "  " }),
        ).toBe("The answer: the mitochondria");
    });

    it("handles a missing answer", () => {
        expect(composeKeeperReply({ correctAnswer: "", rationale: "close" })).toBe("close");
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

describe("wordCrawlStep", () => {
    it("reveals whole words and clamps at the end", () => {
        expect(wordCrawlStep("one two three", 0)).toBe("");
        expect(wordCrawlStep("one two three", 2)).toBe("one two");
        expect(wordCrawlStep("one two three", 99)).toBe("one two three");
    });

    it("never goes negative and tolerates empty text", () => {
        expect(wordCrawlStep("one two", -3)).toBe("");
        expect(wordCrawlStep("", 5)).toBe("");
    });
});
