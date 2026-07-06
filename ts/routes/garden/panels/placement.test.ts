// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the placement-exam contract. What's pinned: 20 MCQs split evenly across the
// four MCAT sections (the exam weighs them equally), drawn from the open CC0 MCQ bank
// (panels/mcq.ts), interleaved order, and honest tally/date arithmetic for the calibration
// beat. The bank draw is randomized (same as the sector-stone trials), so these tests assert
// shape/counts/distinctness, never exact question identities.
import { describe, expect, it } from "vitest";

import {
    applyOutcome,
    buildPlacementExam,
    daysUntil,
    formatExamDate,
    partsToIsoDate,
    PLACEMENT_QUESTIONS,
    sectionsByAccuracy,
} from "./placement";

describe("buildPlacementExam", () => {
    it("asks exactly 20 questions, 5 per MCAT section", () => {
        const plan = buildPlacementExam();
        expect(plan).toHaveLength(PLACEMENT_QUESTIONS);
        const perSection = new Map<string, number>();
        for (const q of plan) {
            perSection.set(q.section, (perSection.get(q.section) ?? 0) + 1);
        }
        expect(perSection.get("P-S")).toBe(5);
        expect(perSection.get("B-B")).toBe(5);
        expect(perSection.get("C-P")).toBe(5);
        expect(perSection.get("CARS")).toBe(5);
    });

    it("interleaves sections so the test roams the island (first round hits all four)", () => {
        const plan = buildPlacementExam();
        expect(new Set(plan.slice(0, 4).map((q) => q.section)).size).toBe(4);
    });

    it("never repeats a question within a section (bank is far larger than the quota)", () => {
        const plan = buildPlacementExam();
        for (const section of ["P-S", "B-B", "C-P", "CARS"]) {
            const ids = plan.filter((q) => q.section === section).map((q) => q.id);
            expect(new Set(ids).size).toBe(ids.length);
        }
    });

    it("handles zero and odd totals", () => {
        expect(buildPlacementExam(0)).toEqual([]);
        const plan = buildPlacementExam(6);
        expect(plan).toHaveLength(6);
        // 6 over 4 sections: the earliest two sections in SECTION_ORDER (P-S, B-B) take the
        // +1 remainder, so it's 2/2/1/1.
        const perSection = new Map<string, number>();
        for (const q of plan) {
            perSection.set(q.section, (perSection.get(q.section) ?? 0) + 1);
        }
        expect([...perSection.values()].reduce((a, b) => a + b, 0)).toBe(6);
        expect(perSection.get("P-S")).toBe(2);
        expect(perSection.get("B-B")).toBe(2);
        expect(perSection.get("C-P")).toBe(1);
        expect(perSection.get("CARS")).toBe(1);
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
