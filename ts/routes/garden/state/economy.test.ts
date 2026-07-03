// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: G2.4/GARDEN-3 gate — economy invariants (docs/26 G1.3/G2.4).
//   Start = 40 seeds / 80 water (doc 23 §7). Currency never buys mastery (I4);
//   refills come only from graded answers (water) and blooms (seeds).
import { describe, expect, it } from "vitest";

import {
    canPlant,
    canWater,
    ECONOMY,
    initialBalances,
    onBloom,
    onGradedAnswer,
    onVoiceGradedAnswer,
    spendPlant,
    spendWater,
} from "./economy";

describe("economy — the doc 23 §7 contract", () => {
    it("starts at 40 seeds / 80 water / 0 xp", () => {
        expect(initialBalances()).toEqual({ seeds: 40, water: 80, xp: 0 });
    });

    it("planting spends exactly the configured seed cost", () => {
        const b = spendPlant(initialBalances());
        expect(b.seeds).toBe(40 - ECONOMY.plantCostSeeds);
        expect(b.water).toBe(80);
    });

    it("watering spends exactly the configured pour cost", () => {
        const b = spendWater(initialBalances());
        expect(b.water).toBe(80 - ECONOMY.waterCostPerPour);
        expect(b.seeds).toBe(40);
    });

    it("cannot spend below zero — broke gates close", () => {
        const broke = { seeds: 0, water: 0, xp: 0 };
        expect(canPlant(broke)).toBe(false);
        expect(canWater(broke)).toBe(false);
        expect(() => spendPlant(broke)).toThrow();
        expect(() => spendWater(broke)).toThrow();
    });

    it("a graded answer refills water + xp and NOTHING else", () => {
        const b = onGradedAnswer({ seeds: 7, water: 0, xp: 0 });
        expect(b).toEqual({
            seeds: 7,
            water: ECONOMY.waterPerGradedAnswer,
            xp: ECONOMY.xpPerGradedAnswer,
        });
    });

    it("a bloom pays seeds and NOTHING else", () => {
        const b = onBloom({ seeds: 0, water: 3, xp: 9 });
        expect(b).toEqual({ seeds: ECONOMY.seedsPerBloom, water: 3, xp: 9 });
    });

    it("the loop self-sustains: sow → deliver → refill covers the next sow (R6 never-hard-stalls)", () => {
        // Worked example, doc 23 §7.1: spend 12 water + 3 seeds; delivering the 12 queued
        // pours as graded answers refills >= 12 water; 2 blooms refill >= 2 seeds' cost.
        let b = initialBalances();
        for (let i = 0; i < 12; i++) {
            b = spendWater(b);
        }
        for (let i = 0; i < 3; i++) {
            b = spendPlant(b);
        }
        expect(b.water).toBe(80 - 12);
        expect(b.seeds).toBe(40 - 3);
        for (let i = 0; i < 12; i++) {
            b = onGradedAnswer(b);
        }
        b = onBloom(b);
        b = onBloom(b);
        expect(b.water).toBeGreaterThanOrEqual(80 - 12 + 12 * ECONOMY.waterPerGradedAnswer - 12);
        expect(b.water).toBe(80);
        expect(b.seeds).toBe(40 - 3 + 2 * ECONOMY.seedsPerBloom);
    });

    it("I4: no economy function can raise recall/mastery — the module exports no such path", async () => {
        const mod = await import("./economy");
        const names = Object.keys(mod);
        for (const name of names) {
            expect(name.toLowerCase()).not.toMatch(/mastery|recall|grow|bloom(ed)?state/);
        }
    });
});

describe("onVoiceGradedAnswer — voice spec ruling 2 (+3/+2/+2 recovered/+1)", () => {
    const base = { seeds: 10, water: 10, xp: 0 };

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

    it("never touches seeds (blooms are the only seed path — I4)", () => {
        expect(onVoiceGradedAnswer(base, "good", false).seeds).toBe(10);
        expect(onVoiceGradedAnswer(base, "dont_know", false).seeds).toBe(10);
    });

    it("still grants xp per graded answer", () => {
        expect(onVoiceGradedAnswer(base, "good", false).xp).toBe(
            ECONOMY.xpPerGradedAnswer,
        );
    });
});
