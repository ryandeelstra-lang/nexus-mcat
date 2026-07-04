// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: DEV-ONLY merged-bed preview. Renders the whole island as if EVERY flower
// bloomed — the fastest way to eyeball that beds merge into continuous drifts (the
// 2026-07-03 "everything doesn't merge" fix) without launching the engine. Writes
// /tmp/flora-carpet-preview.ppm when CHARGED_UP_PREVIEW=1; otherwise a passing no-op.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { floraKey, planFlora, sectionAtTile } from "./flora";
import { type EdgeMask, makeBuffer, paintBedCell } from "./flora-carpet";
import { buildTerrainModel, plazaField, sampleDT } from "./terrain";
import { buildWorldPlan, TILE_SIZE } from "./worldgen";

function encodePpm(w: number, h: number, rgb: Uint8Array): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
    const out = new Uint8Array(header.length + rgb.length);
    out.set(header, 0);
    out.set(rgb, header.length);
    return out;
}

describe("flora carpet preview", () => {
    it("renders the fully-bloomed island when CHARGED_UP_PREVIEW=1", { timeout: 60_000 }, () => {
        if (process.env.CHARGED_UP_PREVIEW !== "1") {
            expect(true).toBe(true);
            return;
        }
        const plan = buildWorldPlan();
        const model = buildTerrainModel(plan);
        const layout = planFlora(plan, model);

        const W = plan.widthTiles * TILE_SIZE;
        const H = plan.heightTiles * TILE_SIZE;

        // Background: rough terrain classification (grass/path/water per section palette).
        const GRASS: Record<string, [number, number, number]> = {
            "P-S": [140, 168, 75],
            "B-B": [143, 168, 60],
            "C-P": [86, 122, 22],
            "CARS": [36, 65, 58],
        };
        const bg = new Uint8Array(W * H * 3);
        for (let py = 0; py < H; py += 2) {
            for (let px = 0; px < W; px += 2) {
                const section = sectionAtTile(
                    Math.floor(px / TILE_SIZE),
                    Math.floor(py / TILE_SIZE),
                );
                let c = GRASS[section];
                if (sampleDT(model.waterDT, model.gw, model.gh, px, py) < TILE_SIZE * 0.9) {
                    c = [46, 110, 126];
                } else if (
                    sampleDT(model.trailDT, model.gw, model.gh, px, py) < TILE_SIZE * 0.62
                    || plazaField(px, py) < 1
                ) {
                    c = [205, 176, 134];
                }
                for (let dy = 0; dy < 2; dy++) {
                    for (let dx = 0; dx < 2; dx++) {
                        const o = ((py + dy) * W + px + dx) * 3;
                        bg[o] = c[0];
                        bg[o + 1] = c[1];
                        bg[o + 2] = c[2];
                    }
                }
            }
        }

        // The carpet: every spot at FULL BLOOM; edges continue into same-species neighbors.
        const carpet = makeBuffer(W, H);
        const sameSpecies = (
            spot: { tileX: number; tileY: number; species: { id: string } },
            dx: number,
            dy: number,
        ) => {
            const n = layout.spots.get(floraKey(spot.tileX + dx, spot.tileY + dy));
            return Boolean(n && n.species.id === spot.species.id);
        };
        for (const spot of layout.spots.values()) {
            const edges: EdgeMask = {
                n: sameSpecies(spot, 0, -1),
                e: sameSpecies(spot, 1, 0),
                s: sameSpecies(spot, 0, 1),
                w: sameSpecies(spot, -1, 0),
            };
            paintBedCell(carpet, spot.tileX * TILE_SIZE, spot.tileY * TILE_SIZE, spot, "bloom", edges);
        }

        // Composite carpet over background.
        const out = new Uint8Array(W * H * 3);
        for (let i = 0; i < W * H; i++) {
            const a = carpet.data[i * 4 + 3] / 255;
            out[i * 3] = Math.round(carpet.data[i * 4] * a + bg[i * 3] * (1 - a));
            out[i * 3 + 1] = Math.round(carpet.data[i * 4 + 1] * a + bg[i * 3 + 1] * (1 - a));
            out[i * 3 + 2] = Math.round(carpet.data[i * 4 + 2] * a + bg[i * 3 + 2] * (1 - a));
        }

        const ppm = encodePpm(W, H, out);
        writeFileSync("/tmp/flora-carpet-preview.ppm", ppm);
        expect(ppm.length).toBeGreaterThan(100);
    });
});
