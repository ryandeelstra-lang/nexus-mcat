// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: graded-wilt transform table + application (living-decay 2026-07-05).
// Level 1 must be EXACTLY the shipped art (no transform); clearing must reset all
// three channels — a recovered plant snaps back upright.
import { describe, expect, it } from "vitest";

import { applyWilt, WILT_VISUALS, type WiltSprite } from "./wilt";

function stubSprite(): WiltSprite & {
    angle: number;
    tint: number | null;
    w: number;
    h: number;
} {
    const s = {
        angle: 0,
        tint: null as number | null,
        w: 32,
        h: 44,
        displayWidth: 32,
        displayHeight: 44,
        setAngle(deg: number) {
            s.angle = deg;
        },
        setTint(color: number) {
            s.tint = color;
        },
        clearTint() {
            s.tint = null;
        },
        setDisplaySize(w: number, h: number) {
            s.w = w;
            s.h = h;
            s.displayWidth = w;
            s.displayHeight = h;
        },
    };
    return s;
}

describe("wilt visuals (living-decay 2026-07-05)", () => {
    it("level 1 is the shipped art untouched: no lean, no tint, no sag", () => {
        expect(WILT_VISUALS[1]).toEqual({ angle: 0, tint: null, sag: 1 });
    });

    it("levels escalate monotonically and never go red", () => {
        expect(WILT_VISUALS[2].angle).toBeGreaterThan(WILT_VISUALS[1].angle);
        expect(WILT_VISUALS[3].angle).toBeGreaterThan(WILT_VISUALS[2].angle);
        expect(WILT_VISUALS[3].sag).toBeLessThan(1);
        for (const level of [2, 3] as const) {
            const tint = WILT_VISUALS[level].tint!;
            const r = (tint >> 16) & 0xff;
            const g = (tint >> 8) & 0xff;
            // straw/desaturation, not red: red never dominates green by more than a hair
            expect(r - g).toBeLessThan(24);
        }
    });

    it("applyWilt(level 3) leans, tints and sags the sprite", () => {
        const s = stubSprite();
        applyWilt(s, 3);
        expect(s.angle).toBe(WILT_VISUALS[3].angle);
        expect(s.tint).toBe(WILT_VISUALS[3].tint);
        expect(s.h).toBeCloseTo(44 * WILT_VISUALS[3].sag);
    });

    it("applyWilt(null) fully resets a previously wilted sprite", () => {
        const s = stubSprite();
        applyWilt(s, 3);
        applyWilt(s, null);
        expect(s.angle).toBe(0);
        expect(s.tint).toBeNull();
    });
});
