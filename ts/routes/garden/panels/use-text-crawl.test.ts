// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the crawl's pure step function (voice spec §3.1/§11).
import { describe, expect, it } from "vitest";

import { crawlStep } from "./use-text-crawl";

describe("crawlStep", () => {
    it("reveals character by character and clamps at full length", () => {
        expect(crawlStep("abc", 0)).toBe("");
        expect(crawlStep("abc", 2)).toBe("ab");
        expect(crawlStep("abc", 3)).toBe("abc");
        expect(crawlStep("abc", 99)).toBe("abc");
    });

    it("never goes negative", () => {
        expect(crawlStep("abc", -5)).toBe("");
    });

    it("handles the empty line", () => {
        expect(crawlStep("", 3)).toBe("");
    });
});
