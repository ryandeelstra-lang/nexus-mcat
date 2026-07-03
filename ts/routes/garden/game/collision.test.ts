// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pins the realistic-collision contract (2026-07-03) — feet-only base boxes
// and slide-along-walls movement, so bushes cover you behind / you cover them in front /
// pushing sideways against one glides instead of sticking.
import { describe, expect, it } from "vitest";

import { baseBoxFor, boxesOverlap, footBoxAt, moveWithSlide, type SolidBox } from "./collision";

function blockedBy(boxes: SolidBox[]): (x: number, y: number) => boolean {
    return (x, y) => boxes.some((b) => boxesOverlap(footBoxAt(x, y), b));
}

describe("baseBoxFor", () => {
    it("is a narrow box at the sprite's feet, never the full image", () => {
        // A 64px-wide bush anchored at (100, 200).
        const box = baseBoxFor(100, 200, 64);
        expect(box.w).toBe(32); // half the display width
        expect(box.h).toBe(13);
        expect(box.top + box.h).toBe(200); // sits ON the anchor line
        expect(box.left + box.w / 2).toBe(100);
    });

    it("clamps giant landmarks so their whole plaza never becomes a wall", () => {
        const box = baseBoxFor(0, 0, 400);
        expect(box.w).toBeLessThanOrEqual(72);
    });
});

describe("moveWithSlide", () => {
    const wall: SolidBox = { left: 120, top: 0, w: 16, h: 400 }; // a vertical hedge line

    it("free movement commits both axes", () => {
        const out = moveWithSlide(50, 50, 6, -4, () => false);
        expect(out).toEqual({ x: 56, y: 46 });
    });

    it("pressing diagonally into a wall glides along it (no sticking)", () => {
        // Feet just left of the wall, pushing right+down: X blocks, Y keeps moving.
        const out = moveWithSlide(110, 200, 6, 6, blockedBy([wall]));
        expect(out.x).toBeLessThan(120); // never entered the wall
        expect(out.y).toBeGreaterThan(204); // slid down most of the frame
    });

    it("walking straight into a wall stops cleanly", () => {
        const out = moveWithSlide(110, 200, 8, 0, blockedBy([wall]));
        expect(out.x).toBeLessThan(120);
        expect(out.y).toBe(200);
    });

    it("sub-steps large deltas so thin boxes cannot be tunnelled", () => {
        const thin: SolidBox = { left: 200, top: 0, w: 6, h: 400 };
        const out = moveWithSlide(180, 100, 60, 0, blockedBy([thin]));
        expect(out.x).toBeLessThan(200); // stopped at the box, not teleported past it
    });

    it("feet-only collision walks BEHIND a bush canopy", () => {
        // A bush at (100, 300): its base box guards y≈287..300 only. A player whose feet
        // pass at y=280 walks cleanly behind it (their body overlaps the canopy visually;
        // depth sorting draws the bush over them — no collision).
        const bush = baseBoxFor(100, 300, 48);
        const out = moveWithSlide(60, 280, 80, 0, blockedBy([bush]));
        expect(out.x).toBe(140); // sailed past, right through the canopy line
        // The same walk at feet level y=295 is stopped by the trunk.
        const front = moveWithSlide(60, 295, 80, 0, blockedBy([bush]));
        expect(front.x).toBeLessThan(100);
    });
});
