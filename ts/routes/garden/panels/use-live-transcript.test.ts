// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the display-only live-transcript pure helpers (dialogue-UX plan §2).
import { describe, expect, it } from "vitest";

import { mergeTranscript, readResults } from "./use-live-transcript";

describe("mergeTranscript", () => {
    it("joins settled + interim with a single space", () => {
        expect(mergeTranscript("the mitochondria", "is the")).toBe("the mitochondria is the");
    });

    it("drops empty sides and trims", () => {
        expect(mergeTranscript("  hello ", "")).toBe("hello");
        expect(mergeTranscript("", "  world ")).toBe("world");
        expect(mergeTranscript("", "")).toBe("");
    });
});

describe("readResults", () => {
    // readResults only ever calls `.length`, `.item(i)` and `.item(0)`, so the mock supplies just
    // those; cast through unknown since the Web Speech types aren't exported.
    function list(
        rows: Array<{ isFinal: boolean; transcript: string }>,
    ): Parameters<typeof readResults>[0] {
        const items = rows.map((r) => ({
            isFinal: r.isFinal,
            length: 1,
            item: (_i: number) => ({ transcript: r.transcript }),
        }));
        return {
            length: items.length,
            item: (i: number) => items[i]!,
        } as unknown as Parameters<typeof readResults>[0];
    }

    it("separates settled from in-flight text", () => {
        const out = readResults(
            list([
                { isFinal: true, transcript: "hydrophobic tail" },
                { isFinal: false, transcript: "attached to" },
            ]),
        );
        expect(out.finalText).toBe("hydrophobic tail");
        expect(out.interim).toBe("attached to");
    });

    it("handles an empty result list", () => {
        const out = readResults(list([]));
        expect(out.finalText).toBe("");
        expect(out.interim).toBe("");
    });
});
