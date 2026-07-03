// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: flora invariants (watering redesign, 2026-07-03) — preset per-tile flowers,
// deterministic layout, cohesive color bands (the NW "line of same-colored flowers"),
// bone-meal pour math (aim +2 / ring +1, bloom at 3–7 pours), band celebrations.
import { describe, expect, it } from "vitest";

import { hasAssetKey } from "./assets";
import {
    allFloraSpecies,
    applyPour,
    FLORA_CONFIG,
    floraKey,
    type FloraLayout,
    floraStage,
    planFlora,
    pourProgress,
    splashTiles,
} from "./flora";
import { buildTerrainModel, plazaField, sampleDT } from "./terrain";
import { buildWorldPlan, TILE_SIZE } from "./worldgen";

const plan = buildWorldPlan();
const model = buildTerrainModel(plan);
const layout = planFlora(plan, model);

describe("planFlora — the preset flower layout", () => {
    it("is deterministic", () => {
        const again = planFlora(plan, model);
        expect([...again.spots.keys()]).toEqual([...layout.spots.keys()]);
        for (const [key, spot] of layout.spots) {
            const b = again.spots.get(key)!;
            expect(b.species.id).toBe(spot.species.id);
            expect(b.watersNeeded).toBe(spot.watersNeeded);
            expect(b.bandId).toBe(spot.bandId);
        }
    });

    it("covers every region generously (grass everywhere can flower)", () => {
        const bySection = new Map<string, number>();
        for (const spot of layout.spots.values()) {
            bySection.set(spot.section, (bySection.get(spot.section) ?? 0) + 1);
        }
        for (const section of ["P-S", "B-B", "C-P", "CARS"]) {
            expect(bySection.get(section) ?? 0, `no flowers in ${section}`).toBeGreaterThan(25);
        }
    });

    it("never places a flower on water/shore, the trail, or the plaza", () => {
        for (const spot of layout.spots.values()) {
            const px = (spot.tileX + 0.5) * TILE_SIZE;
            const py = (spot.tileY + 0.5) * TILE_SIZE;
            expect(sampleDT(model.waterDT, model.gw, model.gh, px, py)).toBeGreaterThanOrEqual(
                TILE_SIZE * FLORA_CONFIG.waterClearTiles,
            );
            expect(sampleDT(model.trailDT, model.gw, model.gh, px, py)).toBeGreaterThanOrEqual(
                TILE_SIZE * FLORA_CONFIG.trailClearTiles,
            );
            expect(plazaField(px, py)).toBeGreaterThanOrEqual(FLORA_CONFIG.plazaClear);
        }
    });

    it("keeps clear of plots, props, waystones, and hedges", () => {
        for (const r of plan.regions) {
            const anchors = [
                ...r.plants.map((p) => ({ x: p.tileX, y: p.tileY })),
                ...r.props.map((p) => ({ x: p.tileX, y: p.tileY })),
                { x: r.waystone.tileX, y: r.waystone.tileY },
            ];
            for (const spot of layout.spots.values()) {
                for (const a of anchors) {
                    const d = Math.hypot(spot.tileX - a.x, spot.tileY - a.y);
                    expect(d, `flower at ${spot.tileX},${spot.tileY} overlaps an anchor`)
                        .toBeGreaterThanOrEqual(1);
                }
            }
            for (const h of r.hedges) {
                expect(layout.spots.has(floraKey(h.tileX, h.tileY))).toBe(false);
            }
        }
    });

    it("every tile needs between 3 and 7 pours", () => {
        for (const spot of layout.spots.values()) {
            expect(spot.watersNeeded).toBeGreaterThanOrEqual(FLORA_CONFIG.minWaters);
            expect(spot.watersNeeded).toBeLessThanOrEqual(FLORA_CONFIG.maxWaters);
        }
        // The 3..7 spread is actually used (not all one value).
        const needs = new Set([...layout.spots.values()].map((s) => s.watersNeeded));
        expect(needs.size).toBeGreaterThan(2);
    });

    it("bands are single-species (a watered band is one color, cohesive by design)", () => {
        for (const [bandId, members] of layout.bands) {
            const species = new Set(members.map((k) => layout.spots.get(k)!.species.id));
            expect(species.size, `band ${bandId} mixes species`).toBe(1);
        }
    });

    it("NW Sakura garden has real same-colored LINES along the stream", () => {
        // At least one substantial shoreline band, and multiple distinct colors overall.
        const sakuraBands = [...layout.bands.entries()].filter(([id]) => id.startsWith("P-S:"));
        expect(sakuraBands.length).toBeGreaterThanOrEqual(2);
        const biggest = Math.max(...sakuraBands.map(([, m]) => m.length));
        expect(biggest).toBeGreaterThanOrEqual(10);
        const speciesUsed = new Set(
            [...layout.spots.values()]
                .filter((s) => s.section === "P-S")
                .map((s) => s.species.id),
        );
        expect(speciesUsed.size).toBeGreaterThanOrEqual(2);
        // Same band ⇒ same distance-to-stream bucket ⇒ same species: verified per-band above.
        // Here: a band's tiles hug the same shoreline distance (a line, not a blob).
        const [bandId, members] = sakuraBands.reduce(
            (a, b) => (b[1].length > a[1].length ? b : a),
        );
        const dists = members.map((k) => {
            const s = layout.spots.get(k)!;
            return sampleDT(
                model.waterDT,
                model.gw,
                model.gh,
                (s.tileX + 0.5) * TILE_SIZE,
                (s.tileY + 0.5) * TILE_SIZE,
            );
        });
        const bandWidth = TILE_SIZE * 1.6;
        const bucket = Math.floor(Number(bandId.split(":")[1]));
        for (const d of dists) {
            expect(Math.floor(d / bandWidth)).toBe(bucket);
        }
    });

    it("Keukenhof ribbons are horizontal two-row bands", () => {
        for (const spot of layout.spots.values()) {
            if (spot.section !== "B-B") {
                continue;
            }
            expect(spot.bandId).toBe(`B-B:${Math.floor(spot.tileY / 2)}`);
        }
    });

    it("every species bloom sprite resolves to real sliced art (no placeholders)", () => {
        for (const species of allFloraSpecies()) {
            expect(hasAssetKey(species.assetKey), `missing asset: ${species.assetKey}`).toBe(true);
        }
    });
});

describe("floraStage — bloom thresholds", () => {
    it("maps counts onto none/sprout/bud/bloom", () => {
        expect(floraStage(0, 5)).toBe("none");
        expect(floraStage(1, 5)).toBe("sprout");
        expect(floraStage(2, 5)).toBe("sprout");
        expect(floraStage(3, 5)).toBe("bud"); // 0.6 >= budFraction
        expect(floraStage(4, 5)).toBe("bud");
        expect(floraStage(5, 5)).toBe("bloom");
        expect(floraStage(1, 3)).toBe("sprout");
        expect(floraStage(2, 3)).toBe("bud");
        expect(floraStage(3, 3)).toBe("bloom");
        expect(floraStage(6, 7)).toBe("bud");
        expect(floraStage(7, 7)).toBe("bloom");
    });

    it("never blooms early", () => {
        for (let need = FLORA_CONFIG.minWaters; need <= FLORA_CONFIG.maxWaters; need++) {
            for (let c = 0; c < need; c++) {
                expect(floraStage(c, need)).not.toBe("bloom");
            }
        }
    });
});

/** A tiny synthetic layout: a 3-tile band + a lone extra band, for exact pour math. */
function syntheticLayout(): FloraLayout {
    const species = allFloraSpecies()[0];
    const mk = (tileX: number, tileY: number, watersNeeded: number, bandId: string) => ({
        tileX,
        tileY,
        section: "P-S" as const,
        species,
        watersNeeded,
        bandId,
    });
    const spots = new Map([
        [floraKey(10, 10), mk(10, 10, 3, "P-S:0")],
        [floraKey(11, 10), mk(11, 10, 4, "P-S:0")],
        [floraKey(12, 10), mk(12, 10, 3, "P-S:0")],
        [floraKey(20, 20), mk(20, 20, 5, "P-S:1")],
    ]);
    const bands = new Map([
        ["P-S:0", [floraKey(10, 10), floraKey(11, 10), floraKey(12, 10)]],
        ["P-S:1", [floraKey(20, 20)]],
    ]);
    return { spots, bands };
}

describe("applyPour — bone-meal watering", () => {
    it("gives the aimed tile +2 and the splash ring +1", () => {
        const layout = syntheticLayout();
        const res = applyPour(layout, {}, 11, 10);
        expect(res.counts[floraKey(11, 10)]).toBe(FLORA_CONFIG.aimBoost);
        expect(res.counts[floraKey(10, 10)]).toBe(FLORA_CONFIG.splashBoost);
        expect(res.counts[floraKey(12, 10)]).toBe(FLORA_CONFIG.splashBoost);
        // The far spot is untouched.
        expect(res.counts[floraKey(20, 20)]).toBeUndefined();
    });

    it("the aimed tile blooms first; neighbors wake as sprouts/buds", () => {
        const layout = syntheticLayout();
        let counts = {};
        // Aim at (11,10) twice: aim reaches 4/4 = bloom; ring sits at 2 (sprout/bud).
        counts = applyPour(layout, counts, 11, 10).counts;
        const second = applyPour(layout, counts, 11, 10);
        counts = second.counts;
        const aimed = second.changed.find((c) => c.spot.tileX === 11)!;
        expect(aimed.stage).toBe("bloom");
        const left = second.changed.find((c) => c.spot.tileX === 10)!;
        expect(["sprout", "bud"]).toContain(left.stage);
        expect(left.stage).not.toBe("bloom");
    });

    it("clamps at watersNeeded (no overshoot) and skips saturated tiles", () => {
        const layout = syntheticLayout();
        let counts: Record<string, number> = {};
        for (let i = 0; i < 10; i++) {
            counts = applyPour(layout, counts, 11, 10).counts;
        }
        expect(counts[floraKey(11, 10)]).toBe(4);
        expect(counts[floraKey(10, 10)]).toBe(3);
        const extra = applyPour(layout, counts, 11, 10);
        expect(extra.changed).toHaveLength(0);
    });

    it("pours on flowerless tiles are a no-op", () => {
        const layout = syntheticLayout();
        const res = applyPour(layout, {}, 40, 40);
        expect(res.changed).toHaveLength(0);
        expect(Object.keys(res.counts)).toHaveLength(0);
    });

    it("reports a band completion exactly once, when its last flower blooms", () => {
        const layout = syntheticLayout();
        let counts: Record<string, number> = {};
        let completions: string[] = [];
        for (let i = 0; i < 6; i++) {
            const res = applyPour(layout, counts, 11, 10);
            counts = res.counts;
            completions = [...completions, ...res.bandsCompleted];
        }
        expect(completions).toEqual(["P-S:0"]);
        // The lone far band completes independently.
        let far: string[] = [];
        for (let i = 0; i < 4; i++) {
            const res = applyPour(layout, counts, 20, 20);
            counts = res.counts;
            far = [...far, ...res.bandsCompleted];
        }
        expect(far).toEqual(["P-S:1"]);
    });

    it("splashTiles is the aim plus its 8 neighbors", () => {
        const tiles = splashTiles(5, 5);
        expect(tiles).toHaveLength(9);
        expect(tiles[0]).toEqual({ tileX: 5, tileY: 5 });
    });

    it("pourProgress reports pips for the aimed tile only when a flower is preset", () => {
        const layout = syntheticLayout();
        expect(pourProgress(layout, {}, 40, 40)).toBeNull();
        const counts = applyPour(layout, {}, 11, 10).counts;
        expect(pourProgress(layout, counts, 11, 10)).toEqual({ count: 2, needed: 4 });
    });
});

describe("flora on the real world plan", () => {
    it("a real pour grows only preset spots and persists as a compact record", () => {
        const anySpot = [...layout.spots.values()][0];
        const res = applyPour(layout, {}, anySpot.tileX, anySpot.tileY);
        expect(res.changed.length).toBeGreaterThanOrEqual(1);
        for (const c of res.changed) {
            expect(layout.spots.has(floraKey(c.spot.tileX, c.spot.tileY))).toBe(true);
        }
        // Compact: only watered tiles appear in the record.
        expect(Object.keys(res.counts).length).toBe(res.changed.length);
    });
});
