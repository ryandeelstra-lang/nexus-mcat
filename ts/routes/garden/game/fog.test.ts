// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the onboarding-fog math contract. What's pinned: the plaza is perfectly
// clear, density rises smoothly (no hard band edge — the "blocky" failure mode), the
// noise is deterministic and bounded (a repeatable island, doc 23 §9), and the plaza
// leash keeps the avatar out of the shroud while it stands.
import { describe, expect, it } from "vitest";

import { clampFeetToTileRect, cloudNoise, distanceToRect, fogDensityAt, hash2, smoothstep, type TileRect } from "./fog";

const PLAZA: TileRect = { x: 17, y: 12, w: 11, h: 8 };
const FALLOFF = 2.5;

describe("distanceToRect", () => {
    it("is 0 inside and on the edge, Euclidean outside", () => {
        expect(distanceToRect(22, 16, PLAZA)).toBe(0);
        expect(distanceToRect(17, 12, PLAZA)).toBe(0);
        expect(distanceToRect(14, 16, PLAZA)).toBe(3); // straight west
        expect(distanceToRect(31, 16, PLAZA)).toBe(3); // straight east
        // Corner: 3 west + 4 north of (17,12) -> 5 (the 3-4-5 triangle).
        expect(distanceToRect(14, 8, PLAZA)).toBe(5);
    });
});

describe("fogDensityAt — the soft shroud profile", () => {
    it("keeps the whole plaza perfectly clear", () => {
        for (let x = PLAZA.x; x <= PLAZA.x + PLAZA.w; x += 2) {
            for (let y = PLAZA.y; y <= PLAZA.y + PLAZA.h; y += 2) {
                expect(fogDensityAt(x, y, PLAZA, FALLOFF)).toBe(0);
            }
        }
    });

    it("reaches full density past the falloff and NEVER steps (smooth, not blocky)", () => {
        expect(fogDensityAt(0, 0, PLAZA, FALLOFF)).toBe(1);
        expect(fogDensityAt(43, 31, PLAZA, FALLOFF)).toBe(1);
        // March west out of the plaza in fine steps: density must climb monotonically
        // and no single step may jump (a jump IS a visible band edge).
        let prev = 0;
        for (let d = 0; d <= FALLOFF + 1; d += 0.1) {
            const v = fogDensityAt(PLAZA.x - d, 16, PLAZA, FALLOFF);
            expect(v).toBeGreaterThanOrEqual(prev);
            expect(v - prev).toBeLessThan(0.1);
            prev = v;
        }
        expect(prev).toBe(1);
    });

    it("smoothstep clamps and eases", () => {
        expect(smoothstep(0, 1, -5)).toBe(0);
        expect(smoothstep(0, 1, 5)).toBe(1);
        expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 5);
    });
});

describe("cloudNoise — deterministic, bounded wisps", () => {
    it("is deterministic per seed and position", () => {
        expect(cloudNoise(3.7, 9.1, 6, 42)).toBe(cloudNoise(3.7, 9.1, 6, 42));
        expect(cloudNoise(3.7, 9.1, 6, 42)).not.toBe(cloudNoise(3.7, 9.1, 6, 43));
    });

    it("stays in [0, 1] and actually varies (it is a cloud, not a constant)", () => {
        const samples: number[] = [];
        for (let x = 0; x < 44; x += 1.3) {
            for (let y = 0; y < 32; y += 1.7) {
                const v = cloudNoise(x, y, 6, 7);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
                samples.push(v);
            }
        }
        expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.3);
    });

    it("hash2 spreads uniformly enough to build noise on", () => {
        let sum = 0;
        const n = 1000;
        for (let i = 0; i < n; i++) {
            sum += hash2(i, i * 31 + 7, 5);
        }
        expect(sum / n).toBeGreaterThan(0.4);
        expect(sum / n).toBeLessThan(0.6);
    });
});

describe("clampFeetToTileRect — the plaza leash while the fog is up", () => {
    const tile = 32;

    it("a position inside the plaza is untouched", () => {
        const pos = clampFeetToTileRect(22 * tile, 16 * tile, PLAZA, tile);
        expect(pos).toEqual({ x: 22 * tile, y: 16 * tile });
    });

    it("pushing into the shroud clamps back to the plaza edge", () => {
        const west = clampFeetToTileRect(2 * tile, 16 * tile, PLAZA, tile);
        expect(west.x).toBe(PLAZA.x * tile + 2);
        const south = clampFeetToTileRect(22 * tile, 31 * tile, PLAZA, tile);
        expect(south.y).toBe((PLAZA.y + PLAZA.h) * tile - 2);
        const north = clampFeetToTileRect(22 * tile, 0, PLAZA, tile);
        expect(north.y).toBe(PLAZA.y * tile + tile * 0.5 + 2);
    });
});
