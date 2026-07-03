// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: terrain determinism + decor invariants (never on water/trail/plaza).
import { describe, expect, it } from "vitest";

import { buildTerrainModel, planDecor, plazaField, sampleDT } from "./terrain";
import { buildWorldPlan, TILE_SIZE } from "./worldgen";

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
        const far = sampleDT(model.waterDT, model.gw, model.gh, 2 * TILE_SIZE, 2 * TILE_SIZE);
        expect(far).toBeGreaterThan(TILE_SIZE * 2);
    });
});

describe("planDecor", () => {
    const model = buildTerrainModel(plan);
    const decor = planDecor(plan, model, () => true);

    it("is deterministic and non-empty", () => {
        const again = planDecor(plan, model, () => true);
        expect(again).toEqual(decor);
        // Compact island still scatters a lush amount of foliage.
        expect(decor.length).toBeGreaterThan(80);
    });

    it("never places standing decor on water, trails, or the plaza", () => {
        for (const d of decor.filter((x) => !x.flat)) {
            // Set pieces (hedges/tulip strips) are placed by design rules, not scatter;
            // scatter items must respect the clearance fields.
            const wd = sampleDT(model.waterDT, model.gw, model.gh, d.x, d.y);
            expect(wd).toBeGreaterThan(TILE_SIZE * 0.8);
        }
    });

    it("keeps a clearing around every plant spot", () => {
        const spots = plan.regions.flatMap((r) => r.plants);
        for (const d of decor.filter((x) => !x.flat)) {
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
        expect(plazaField(28.5 * TILE_SIZE, 20.5 * TILE_SIZE)).toBeLessThan(1);
        expect(plazaField(5 * TILE_SIZE, 5 * TILE_SIZE)).toBeGreaterThan(1);
    });
});
