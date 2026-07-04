// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the placement-plan contract. What's pinned: 20 questions split evenly across
// the four MCAT sections (the exam weighs them equally), distinct leaves preferred inside a
// section (cycling only when the section is smaller than its quota — CARS), interleaved
// order, and honest tally/date arithmetic for the calibration beat.
import { describe, expect, it } from "vitest";

import {
    applyOutcome,
    buildPlacementPlan,
    daysUntil,
    formatExamDate,
    partsToIsoDate,
    PLACEMENT_QUESTIONS,
    type PlacementTopic,
    sectionsByAccuracy,
} from "./placement";

/** The real island's shape: P-S 12 leaves, C-P 10, B-B 9, CARS 3 (34 total). */
function islandTopics(): PlacementTopic[] {
    const make = (section: string, count: number): PlacementTopic[] =>
        Array.from({ length: count }, (_, i) => ({
            nodeId: `${section}.${i}`,
            deckPath: `MCAT::${section}::${i}`,
            label: `${section} topic ${i}`,
            section,
            dueCount: 0,
            newCount: 10,
        }));
    return [
        ...make("P-S", 12),
        ...make("C-P", 10),
        ...make("B-B", 9),
        ...make("CARS", 3),
    ];
}

describe("buildPlacementPlan", () => {
    it("asks exactly 20 questions, 5 per MCAT section", () => {
        const plan = buildPlacementPlan(islandTopics());
        expect(plan).toHaveLength(PLACEMENT_QUESTIONS);
        const perSection = new Map<string, number>();
        for (const step of plan) {
            perSection.set(step.section, (perSection.get(step.section) ?? 0) + 1);
        }
        expect(perSection.get("P-S")).toBe(5);
        expect(perSection.get("B-B")).toBe(5);
        expect(perSection.get("C-P")).toBe(5);
        expect(perSection.get("CARS")).toBe(5);
    });

    it("interleaves sections so the test roams the island (first round hits all four)", () => {
        const plan = buildPlacementPlan(islandTopics());
        expect(new Set(plan.slice(0, 4).map((s) => s.section)).size).toBe(4);
    });

    it("prefers distinct leaves; cycles only where the section is smaller than its quota", () => {
        const plan = buildPlacementPlan(islandTopics());
        const psLeaves = plan.filter((s) => s.section === "P-S").map((s) => s.nodeId);
        expect(new Set(psLeaves).size).toBe(5);
        // CARS has 3 leaves for 5 questions -> every leaf asked, none more than twice.
        const carsLeaves = plan.filter((s) => s.section === "CARS").map((s) => s.nodeId);
        expect(new Set(carsLeaves).size).toBe(3);
    });

    it("puts leaves with servable cards ahead of empty ones", () => {
        const topics = islandTopics().map((t) =>
            t.section === "B-B" && t.nodeId !== "B-B.7"
                ? { ...t, newCount: 0, dueCount: 0 }
                : t
        );
        const plan = buildPlacementPlan(topics);
        expect(plan.filter((s) => s.section === "B-B")[0].nodeId).toBe("B-B.7");
    });

    it("handles an empty snapshot and odd totals", () => {
        expect(buildPlacementPlan([])).toEqual([]);
        const plan = buildPlacementPlan(islandTopics(), 6);
        expect(plan).toHaveLength(6);
        // 6 over 4 sections: earliest sections take the remainder (2+2+1+1? no: 1 each +2).
        const perSection = new Map<string, number>();
        for (const step of plan) {
            perSection.set(step.section, (perSection.get(step.section) ?? 0) + 1);
        }
        expect([...perSection.values()].reduce((a, b) => a + b, 0)).toBe(6);
        expect(Math.max(...perSection.values())).toBe(2);
        expect(Math.min(...perSection.values())).toBe(1);
    });
});

describe("tally + calibration arithmetic", () => {
    it("applyOutcome accumulates per section", () => {
        let tally = applyOutcome({}, "P-S", true);
        tally = applyOutcome(tally, "P-S", false);
        tally = applyOutcome(tally, "CARS", true);
        expect(tally["P-S"]).toEqual({ asked: 2, knew: 1 });
        expect(tally["CARS"]).toEqual({ asked: 1, knew: 1 });
    });

    it("sectionsByAccuracy ranks weakest first", () => {
        const tally = {
            "P-S": { asked: 5, knew: 4 },
            "B-B": { asked: 5, knew: 1 },
            "CARS": { asked: 5, knew: 3 },
            "C-P": { asked: 0, knew: 0 },
        };
        expect(sectionsByAccuracy(tally)).toEqual(["B-B", "CARS", "P-S"]);
    });

    it("daysUntil does honest whole-day math and refuses bad input", () => {
        const now = Date.parse("2026-07-03T12:00:00");
        expect(daysUntil("2026-10-15", now)).toBe(104);
        expect(daysUntil(null, now)).toBeNull();
        expect(daysUntil("not-a-date", now)).toBeNull();
    });
});

describe("exam-date field (native-picker-free intake)", () => {
    it("assembles valid parts into a canonical ISO date daysUntil can read back", () => {
        const iso = partsToIsoDate(2026, 10, 15);
        expect(iso).toBe("2026-10-15");
        // The whole point: the value round-trips through the same math the calibration uses.
        expect(daysUntil(iso, Date.parse("2026-07-03T12:00:00"))).toBe(104);
    });

    it("zero-pads single-digit month and day", () => {
        expect(partsToIsoDate(2027, 3, 9)).toBe("2027-03-09");
    });

    it("returns null while any part is still empty (button stays disabled)", () => {
        expect(partsToIsoDate(null, 10, 15)).toBeNull();
        expect(partsToIsoDate(2026, null, 15)).toBeNull();
        expect(partsToIsoDate(2026, 10, null)).toBeNull();
    });

    it("rejects impossible calendar dates instead of coercing them", () => {
        expect(partsToIsoDate(2026, 13, 1)).toBeNull(); // month out of range
        expect(partsToIsoDate(2026, 2, 30)).toBeNull(); // Feb 30 never exists
        expect(partsToIsoDate(2026, 4, 31)).toBeNull(); // April has 30 days
        expect(partsToIsoDate(2026, 0, 10)).toBeNull(); // month 0
        expect(partsToIsoDate(26, 10, 15)).toBeNull(); // 2-digit year is not a real year
    });

    it("honors leap years", () => {
        expect(partsToIsoDate(2028, 2, 29)).toBe("2028-02-29"); // 2028 is a leap year
        expect(partsToIsoDate(2027, 2, 29)).toBeNull(); // 2027 is not
    });

    it("rejects non-integer parts (e.g. a stray decimal)", () => {
        expect(partsToIsoDate(2026, 10.5, 15)).toBeNull();
        expect(partsToIsoDate(Number.NaN, 10, 15)).toBeNull();
    });

    it("formatExamDate gives a human confirmation, or '' for unknown/invalid", () => {
        expect(formatExamDate("2026-10-15")).toBe("Thu · Oct 15, 2026");
        expect(formatExamDate(null)).toBe("");
        expect(formatExamDate("not-a-date")).toBe("");
    });
});
