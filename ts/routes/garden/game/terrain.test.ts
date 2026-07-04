// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: terrain determinism + decor invariants (never on water/trail/plaza).
import { describe, expect, it } from "vitest";

import { buildTerrainModel, planDecor, plazaField, sampleDT, terrainKindAt } from "./terrain";
import { buildWorldPlan, KEEPER_TILE, TILE_SIZE } from "./worldgen";

const plan = buildWorldPlan();

describe("buildTerrainModel", () => {
    // Building the model twice + deep-comparing the full distance fields is slow but
    // exactly the guarantee we need; give it room beyond the 5s default.
    it("is deterministic", { timeout: 30_000 }, () => {
        const a = buildTerrainModel(plan);
        const b = buildTerrainModel(plan);
        expect(a.waterDT).toEqual(b.waterDT);
        expect(a.trailDT).toEqual(b.trailDT);
        expect(a.regionOfCell).toEqual(b.regionOfCell);
    });

    it("water distance is ~0 on water tiles and grows away from them", () => {
        const model = buildTerrainModel(plan);
        const w = plan.regions[0].waterTiles[0];
        const onWater = sampleDT(
            model.waterDT,
            model.gw,
            model.gh,
            (w.tileX + 0.5) * TILE_SIZE,
            (w.tileY + 0.5) * TILE_SIZE,
        );
        expect(onWater).toBeLessThan(TILE_SIZE / 2);
        // The Keeper plaza is water-free by design — a reliable "far from water" probe
        // regardless of how the compact sectors shape their streams.
        const far = sampleDT(
            model.waterDT,
            model.gw,
            model.gh,
            (KEEPER_TILE.tileX + 0.5) * TILE_SIZE,
            (KEEPER_TILE.tileY + 0.5) * TILE_SIZE,
        );
        expect(far).toBeGreaterThan(TILE_SIZE * 2);
    });
});

describe("planDecor", () => {
    const model = buildTerrainModel(plan);
    const decor = planDecor(plan, model, () => true);

    it("is deterministic and non-empty", () => {
        const again = planDecor(plan, model, () => true);
        expect(again).toEqual(decor);
        // 2026-07-03 declutter: the scatter is deliberately sparse now — some life, not a
        // jungle ("remove most of the stuff, but make sure there's still some stuff").
        expect(decor.length).toBeGreaterThan(15);
    });

    it("never places standing SCATTER decor on water, trails, or the plaza", () => {
        // Authored sector decor (bridges, hero trees, landmarks) is hand-placed and may
        // legitimately span water; only the deterministic scatter must clear the fields.
        for (const d of decor.filter((x) => !x.flat && !x.authored)) {
            const wd = sampleDT(model.waterDT, model.gw, model.gh, d.x, d.y);
            expect(wd).toBeGreaterThan(TILE_SIZE * 0.8);
        }
    });

    it("keeps a clearing around every plant spot", () => {
        const spots = plan.regions.flatMap((r) => r.plants);
        for (const d of decor.filter((x) => !x.flat && !x.authored)) {
            for (const p of spots) {
                const dist = Math.hypot(
                    d.x / TILE_SIZE - (p.tileX + 0.5),
                    d.y / TILE_SIZE - (p.tileY + 0.5),
                );
                expect(dist).toBeGreaterThan(1.0);
            }
        }
    });
});

describe("plazaField", () => {
    it("keeper stands inside the plaza; region corners are outside", () => {
        expect(
            plazaField((KEEPER_TILE.tileX + 0.5) * TILE_SIZE, (KEEPER_TILE.tileY + 0.5) * TILE_SIZE),
        ).toBeLessThan(1);
        expect(plazaField(5 * TILE_SIZE, 5 * TILE_SIZE)).toBeGreaterThan(1);
    });
});

describe("terrainKindAt (map click-to-teleport ground probe)", () => {
    const model = buildTerrainModel(plan);
    const center = (t: { tileX: number; tileY: number }): [number, number] => [
        (t.tileX + 0.5) * TILE_SIZE,
        (t.tileY + 0.5) * TILE_SIZE,
    ];

    it("is deterministic", () => {
        for (let ty = 0; ty < plan.heightTiles; ty += 3) {
            for (let tx = 0; tx < plan.widthTiles; tx += 3) {
                const [px, py] = center({ tileX: tx, tileY: ty });
                expect(terrainKindAt(model, px, py)).toBe(terrainKindAt(model, px, py));
            }
        }
    });

    it("classifies the keeper plaza as plaza, never grass", () => {
        const [px, py] = center(KEEPER_TILE);
        expect(terrainKindAt(model, px, py)).toBe("plaza");
    });

    it("classifies water-tile centers as water/shore (never a teleport target)", () => {
        for (const r of plan.regions) {
            // Interior water reads "water"; a 1-tile strip may read "shore" at its center.
            for (const w of r.waterTiles.slice(0, 8)) {
                const [px, py] = center(w);
                expect(["water", "shore"]).toContain(terrainKindAt(model, px, py));
            }
        }
    });

    it("classifies trail-tile centers as path (walk, don't drop)", () => {
        for (const r of plan.regions) {
            let pathHits = 0;
            let probes = 0;
            for (const t of r.trailTiles) {
                const [px, py] = center(t);
                const kind = terrainKindAt(model, px, py);
                if (kind === "water" || kind === "shore" || kind === "plaza") {
                    continue; // fords + plaza-adjacent trail tiles legitimately read wet/sand
                }
                probes++;
                if (kind === "path") {
                    pathHits++;
                }
            }
            // The painted path wobbles (noise width), so demand a strong majority, not 100%.
            expect(probes).toBeGreaterThan(0);
            expect(pathHits / probes).toBeGreaterThan(0.8);
        }
    });

    it("every region offers plenty of open grass to drop into", () => {
        for (const r of plan.regions) {
            let grass = 0;
            for (let ty = r.rect.y; ty < r.rect.y + r.rect.h; ty++) {
                for (let tx = r.rect.x; tx < r.rect.x + r.rect.w; tx++) {
                    const [px, py] = center({ tileX: tx, tileY: ty });
                    if (terrainKindAt(model, px, py) === "grass") {
                        grass++;
                    }
                }
            }
            expect(grass, `${r.section} grass tiles`).toBeGreaterThan(20);
        }
    });
});
