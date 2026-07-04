// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: geometry invariants for the Overlook (the Super Depth Analysis island).
// The island supplies its OWN containment (outside the plan rect the void is
// terrain-open), so these tests are the wall that keeps the sky from becoming a floor.
import { describe, expect, it } from "vitest";

import { DEPTH_STAT_ORDER } from "../state/depth-stats";
import {
    buildIslandPlan,
    islandCameraBounds,
    islandContainsPoint,
    islandFootBlocked,
    renderIslandSurface,
    tileKey,
} from "./island";
import { TILE_SIZE, WORLD_HEIGHT_TILES, WORLD_WIDTH_TILES } from "./worldgen";

const ts = TILE_SIZE;

/** Feet pixel for standing ON a tile (bottom-center convention). */
function feetAt(tileX: number, tileY: number): { x: number; y: number } {
    return { x: tileX * ts + ts / 2, y: (tileY + 1) * ts };
}

describe("island plan geometry", () => {
    const plan = buildIslandPlan();

    it("is deterministic", () => {
        const again = buildIslandPlan();
        expect([...again.walkable].sort()).toEqual([...plan.walkable].sort());
        expect(again.statSpots).toEqual(plan.statSpots);
        expect(again.arrival).toEqual(plan.arrival);
        expect(again.returnStone).toEqual(plan.returnStone);
    });

    it("floats fully EAST of the world rect (never overlaps, never north — the depth rule)", () => {
        expect(plan.sky.tileX).toBeGreaterThan(WORLD_WIDTH_TILES);
        expect(plan.sky.tileY).toBeGreaterThanOrEqual(0);
        for (const key of plan.walkable) {
            const [x, y] = key.split(",").map(Number);
            expect(x).toBeGreaterThan(WORLD_WIDTH_TILES);
            expect(y).toBeGreaterThanOrEqual(0);
        }
    });

    it("keeps at least one sky tile between the island body and the sky-rect edge", () => {
        for (const key of plan.walkable) {
            const [x, y] = key.split(",").map(Number);
            expect(x).toBeGreaterThan(plan.sky.tileX);
            expect(x).toBeLessThan(plan.sky.tileX + plan.sky.widthTiles - 1);
            expect(y).toBeGreaterThan(plan.sky.tileY);
            expect(y).toBeLessThan(plan.sky.tileY + plan.sky.heightTiles - 1);
        }
    });

    it("has walkable arrival spots, return stone, and monuments", () => {
        for (const t of plan.arrival) {
            expect(plan.walkable.has(tileKey(t.tileX, t.tileY))).toBe(true);
            expect(islandFootBlocked(plan, feetAt(t.tileX, t.tileY).x, feetAt(t.tileX, t.tileY).y))
                .toBe(false);
        }
        expect(plan.walkable.has(tileKey(plan.returnStone.tileX, plan.returnStone.tileY))).toBe(true);
        for (const spot of plan.statSpots) {
            expect(plan.walkable.has(tileKey(spot.tileX, spot.tileY))).toBe(true);
        }
    });

    it("has one monument per depth stat, ring-ordered and spaced", () => {
        expect(plan.statSpots.map((s) => s.id)).toEqual([...DEPTH_STAT_ORDER]);
        for (let i = 0; i < plan.statSpots.length; i++) {
            for (let j = i + 1; j < plan.statSpots.length; j++) {
                const a = plan.statSpots[i];
                const b = plan.statSpots[j];
                const d = Math.hypot(a.tileX - b.tileX, a.tileY - b.tileY);
                expect(d).toBeGreaterThanOrEqual(2);
            }
            // Monuments never crowd the return stone's landing.
            const s = plan.statSpots[i];
            const dr = Math.hypot(s.tileX - plan.returnStone.tileX, s.tileY - plan.returnStone.tileY);
            expect(dr).toBeGreaterThanOrEqual(2);
        }
    });
});

describe("island containment (the sky is not a floor)", () => {
    const plan = buildIslandPlan();

    it("contains island pixels, not garden or gap pixels", () => {
        const center = feetAt(plan.returnStone.tileX, plan.returnStone.tileY + 2);
        expect(islandContainsPoint(plan, center.x, center.y)).toBe(true);
        // Garden interior.
        expect(islandContainsPoint(plan, 22 * ts, 16 * ts)).toBe(false);
        // The void gap between the world's east rim and the sky rect.
        expect(islandContainsPoint(plan, (WORLD_WIDTH_TILES + 0.5) * ts, 10 * ts)).toBe(false);
        expect(WORLD_HEIGHT_TILES).toBeGreaterThan(0);
    });

    it("opens the island interior and blocks the rim and open sky", () => {
        const inside = feetAt(plan.returnStone.tileX, plan.returnStone.tileY + 2);
        expect(islandFootBlocked(plan, inside.x, inside.y)).toBe(false);
        // One tile past the island's east edge on its widest row: open sky.
        const widest = Math.max(
            ...[...plan.walkable].map((k) => Number(k.split(",")[0])),
        );
        const skyFeet = feetAt(widest + 1, 10);
        expect(islandFootBlocked(plan, skyFeet.x, skyFeet.y)).toBe(true);
        // High in the sky rect.
        const high = feetAt(plan.sky.tileX + 2, plan.sky.tileY + 1);
        expect(islandFootBlocked(plan, high.x, high.y)).toBe(true);
    });
});

describe("island camera bounds", () => {
    it("covers the largest world slice the zoom formula can show (no void on screen)", () => {
        const plan = buildIslandPlan();
        const b = islandCameraBounds(plan);
        // world-scene BASE_ZOOM guarantees at most (1280/1.5 x 720/1.5) world px visible.
        expect(b.width).toBeGreaterThanOrEqual(1280 / 1.5);
        expect(b.height).toBeGreaterThanOrEqual(720 / 1.5);
        expect(b.x).toBe(plan.sky.tileX * ts);
        expect(b.y).toBe(plan.sky.tileY * ts);
    });
});

describe("island surface painter", () => {
    const plan = buildIslandPlan();
    const surface = renderIslandSurface(plan);

    it("paints the whole sky rect, opaque and deterministic", () => {
        expect(surface.width).toBe(plan.sky.widthTiles * ts);
        expect(surface.height).toBe(plan.sky.heightTiles * ts);
        expect(surface.data.length).toBe(surface.width * surface.height * 4);
        // Opaque spot-checks (corner sky, island center).
        expect(surface.data[3]).toBe(255);
        const again = renderIslandSurface(plan);
        expect(Buffer.from(again.data).equals(Buffer.from(surface.data))).toBe(true);
    });

    it("reads as grass on the island and sky above it", () => {
        const at = (tileX: number, tileY: number): [number, number, number] => {
            const px = tileX * ts + ts / 2 - plan.sky.tileX * ts;
            const py = tileY * ts + ts / 2 - plan.sky.tileY * ts;
            const i = (py * surface.width + px) * 4;
            return [surface.data[i], surface.data[i + 1], surface.data[i + 2]];
        };
        // Island interior: green dominates.
        const grass = at(plan.returnStone.tileX - 1, plan.returnStone.tileY + 1);
        expect(grass[1]).toBeGreaterThan(grass[0]);
        expect(grass[1]).toBeGreaterThan(grass[2]);
        // Top of the sky rect: blue dominates red.
        const sky = at(plan.sky.tileX + 2, plan.sky.tileY);
        expect(sky[2]).toBeGreaterThan(sky[0]);
    });
});
