// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: overgrowth density + placement (living-decay spec 2026-07-05).
// Pins the spec gates: ≥1-day gate, 5-day cap, weedy suppression (the protected
// error-cause weed stays focal), zero-due ⇒ nothing, deterministic placement.
import { describe, expect, it } from "vitest";

import {
    OVERGROWTH_MAX_DAYS,
    OVERGROWTH_MAX_TUFTS,
    tuftCountFor,
    tuftPlacements,
} from "./overgrowth";

describe("tuftCountFor — the neglect ramp", () => {
    it("nothing while active: < 1 full day away ⇒ 0 tufts", () => {
        expect(tuftCountFor({ daysAway: 0, dueCount: 12, stage: "drooping" })).toBe(0);
        expect(tuftCountFor({ daysAway: 0.9, dueCount: 12, stage: "drooping" })).toBe(0);
    });
    it("nothing without overdue cards, whatever the absence", () => {
        expect(tuftCountFor({ daysAway: 9, dueCount: 0, stage: "bloomed" })).toBe(0);
    });
    it("weedy plots are suppressed — the cause-icon weed stays the focal care-state", () => {
        expect(tuftCountFor({ daysAway: 9, dueCount: 12, stage: "weedy" })).toBe(0);
    });
    it("ramps with days away and caps at the max", () => {
        const d1 = tuftCountFor({ daysAway: 1, dueCount: 5, stage: "drooping" });
        const d3 = tuftCountFor({ daysAway: 3, dueCount: 5, stage: "drooping" });
        const d5 = tuftCountFor({ daysAway: OVERGROWTH_MAX_DAYS, dueCount: 5, stage: "drooping" });
        const d30 = tuftCountFor({ daysAway: 30, dueCount: 50, stage: "drooping" });
        expect(d1).toBeGreaterThanOrEqual(1);
        expect(d3).toBeGreaterThan(d1);
        expect(d5).toBeGreaterThanOrEqual(d3);
        expect(d30).toBeLessThanOrEqual(OVERGROWTH_MAX_TUFTS);
    });
    it("a deep due pile pulls slightly more growth than a shallow one", () => {
        const shallow = tuftCountFor({ daysAway: 3, dueCount: 2, stage: "drooping" });
        const deep = tuftCountFor({ daysAway: 3, dueCount: 25, stage: "drooping" });
        expect(deep).toBeGreaterThanOrEqual(shallow);
    });
});

describe("tuftPlacements — seeded, stable, grounded", () => {
    it("deterministic: same plot id ⇒ identical layout across calls", () => {
        expect(tuftPlacements("BB.1A", 5)).toEqual(tuftPlacements("BB.1A", 5));
    });
    it("different plots get different layouts", () => {
        expect(tuftPlacements("BB.1A", 5)).not.toEqual(tuftPlacements("PS.2C", 5));
    });
    it("count is honored and offsets stay near the plot (≤ 1.6 tiles)", () => {
        const p = tuftPlacements("BB.1A", OVERGROWTH_MAX_TUFTS);
        expect(p).toHaveLength(OVERGROWTH_MAX_TUFTS);
        for (const t of p) {
            expect(Math.hypot(t.dx, t.dy)).toBeLessThanOrEqual(1.6);
            expect(t.size).toBeGreaterThan(0);
            expect(t.size).toBeLessThan(0.6);
        }
    });
    it("growing the count keeps earlier placements stable (fade-in only adds)", () => {
        const three = tuftPlacements("BB.1A", 3);
        const six = tuftPlacements("BB.1A", 6);
        expect(six.slice(0, 3)).toEqual(three);
    });
});
