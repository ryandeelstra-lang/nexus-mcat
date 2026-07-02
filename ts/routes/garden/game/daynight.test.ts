// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: table tests for doc 23 §9.5 day/night sky states.
import { describe, expect, it } from "vitest";

import { skyStateFor } from "./daynight";

function at(hour: number, minute = 0): Date {
    const d = new Date(2026, 6, 2, hour, minute, 0, 0);
    return d;
}

describe("skyStateFor — doc 23 §9.5 six reference times", () => {
    it("4:00 AM → night", () => {
        const s = skyStateFor(at(4, 0));
        expect(s.phase).toBe("night");
        expect(s.dayProgress).toBe(0);
    });

    it("8:00 AM → sunrise", () => {
        const s = skyStateFor(at(8, 0));
        expect(s.phase).toBe("sunrise");
        expect(s.dayProgress).toBe(0);
    });

    it("1:00 PM → morning climb", () => {
        const s = skyStateFor(at(13, 0));
        expect(s.phase).toBe("morning");
        expect(s.dayProgress).toBeGreaterThan(0.2);
        expect(s.dayProgress).toBeLessThan(0.4);
    });

    it("6:00 PM → peak (solar noon)", () => {
        const s = skyStateFor(at(18, 0));
        expect(s.phase).toBe("peak");
        expect(s.dayProgress).toBeCloseTo(0.5, 1);
    });

    it("11:00 PM → evening descent", () => {
        const s = skyStateFor(at(23, 0));
        expect(["evening", "dusk"]).toContain(s.phase);
        expect(s.dayProgress).toBeGreaterThan(0.7);
    });

    it("3:59 AM → dusk/night boundary", () => {
        const s = skyStateFor(at(3, 59));
        expect(["dusk", "evening", "night"]).toContain(s.phase);
        expect(s.dayProgress).toBeGreaterThan(0.9);
    });
});
