// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G2.4/GARDEN-3 gate — economy invariants (docs/26 G1.3/G2.4).
//   Start = 80 water (doc 23 §7; seeds removed 2026-07-03). Currency never buys
//   mastery (I4); water refills come only from graded answers.
import { describe, expect, it } from "vitest";

import {
    canWater,
    ECONOMY,
    initialBalances,
    onGradedAnswer,
    onVoiceGradedAnswer,
    spendWater,
} from "./economy";

describe("economy — the doc 23 §7 contract", () => {
    it("starts at 80 water / 0 xp — and no other currency exists", () => {
        expect(initialBalances()).toEqual({ water: 80, xp: 0 });
    });

    it("watering spends exactly the configured pour cost", () => {
        const b = spendWater(initialBalances());
        expect(b.water).toBe(80 - ECONOMY.waterCostPerPour);
    });

    it("cannot spend below zero — broke gates close", () => {
        const broke = { water: 0, xp: 0 };
        expect(canWater(broke)).toBe(false);
        expect(() => spendWater(broke)).toThrow();
    });

    it("a graded answer refills water + xp and NOTHING else", () => {
        const b = onGradedAnswer({ water: 0, xp: 0 });
        expect(b).toEqual({
            water: ECONOMY.waterPerGradedAnswer,
            xp: ECONOMY.xpPerGradedAnswer,
        });
    });

    it("the loop self-sustains: pour → deliver → refill covers the next pour (R6 never-hard-stalls)", () => {
        // Worked example, doc 23 §7.1: spend 12 water; delivering the 12 queued
        // pours as graded answers refills >= 12 water.
        let b = initialBalances();
        for (let i = 0; i < 12; i++) {
            b = spendWater(b);
        }
        expect(b.water).toBe(80 - 12);
        for (let i = 0; i < 12; i++) {
            b = onGradedAnswer(b);
        }
        expect(b.water).toBe(80 - 12 + 12 * ECONOMY.waterPerGradedAnswer);
        expect(b.water).toBeGreaterThanOrEqual(80);
    });

    it("I4: no economy function can raise recall/mastery — the module exports no such path", async () => {
        const mod = await import("./economy");
        const names = Object.keys(mod);
        for (const name of names) {
            expect(name.toLowerCase()).not.toMatch(/mastery|recall|grow|bloom/);
        }
    });

    it("seeds are gone: no config knob, balance field, or function mentions them", async () => {
        const mod = await import("./economy");
        for (const name of Object.keys(mod)) {
            expect(name.toLowerCase()).not.toContain("seed");
            expect(name.toLowerCase()).not.toContain("plant");
        }
        expect(Object.keys(ECONOMY).join(" ").toLowerCase()).not.toContain("seed");
        expect(initialBalances()).not.toHaveProperty("seeds");
    });
});

describe("onVoiceGradedAnswer — voice spec ruling 2 (+3/+2/+2 recovered/+1)", () => {
    const base = { water: 10, xp: 0 };

    it("pays +3 water for good", () => {
        expect(onVoiceGradedAnswer(base, "good", false).water).toBe(13);
    });

    it("pays +2 for okay", () => {
        expect(onVoiceGradedAnswer(base, "okay", false).water).toBe(12);
    });

    it("pays +2 for a recovered second attempt (spec wins over as-built +3)", () => {
        expect(onVoiceGradedAnswer(base, "good", true).water).toBe(12);
        expect(onVoiceGradedAnswer(base, "okay", true).water).toBe(12);
    });

    it("pays +1 for dont_know and terminal ask_again — showing up still pays", () => {
        expect(onVoiceGradedAnswer(base, "dont_know", false).water).toBe(11);
        expect(onVoiceGradedAnswer(base, "ask_again", false).water).toBe(11);
    });

    it("still grants xp per graded answer", () => {
        expect(onVoiceGradedAnswer(base, "good", false).xp).toBe(
            ECONOMY.xpPerGradedAnswer,
        );
    });
});
