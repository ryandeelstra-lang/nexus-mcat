// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: DEV-ONLY schematic preview generator. Rasterizes buildWorldPlan() into a
// top-down PNG so a human can eyeball the composed sectors (paths, water, plots, props,
// hedges, gates, landmarks) without launching the engine. Writes /tmp/garden-preview.png
// when CHARGED_UP_PREVIEW=1; otherwise it is a no-op that still passes.
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { effectivePalettePreview } from "./preview-palette";
import { buildWorldPlan } from "../worldgen";

const SCALE = 12; // px per tile

/** Encode a binary PPM (P6) — trivially correct, then converted to PNG by `sips` outside. */
function encodePpm(w: number, h: number, rgb: Uint8Array): Uint8Array {
    const header = new TextEncoder().encode(`P6\n${w} ${h}\n255\n`);
    const out = new Uint8Array(header.length + rgb.length);
    out.set(header, 0);
    out.set(rgb, header.length);
    return out;
}

describe("sector preview", () => {
    it("renders a schematic map when CHARGED_UP_PREVIEW=1", () => {
        if (process.env.CHARGED_UP_PREVIEW !== "1") {
            expect(true).toBe(true);
            return;
        }
        const plan = buildWorldPlan();
        const W = plan.widthTiles * SCALE;
        const H = plan.heightTiles * SCALE;
        const px = new Uint8Array(W * H * 3);
        const set = (x: number, y: number, r: number, g: number, b: number): void => {
            if (x < 0 || y < 0 || x >= W || y >= H) {
                return;
            }
            const i = (y * W + x) * 3;
            px[i] = r;
            px[i + 1] = g;
            px[i + 2] = b;
        };
        const cell = (tx: number, ty: number, c: [number, number, number], inset = 0): void => {
            for (let y = ty * SCALE + inset; y < (ty + 1) * SCALE - inset; y++) {
                for (let x = tx * SCALE + inset; x < (tx + 1) * SCALE - inset; x++) {
                    set(x, y, c[0], c[1], c[2]);
                }
            }
        };
        const dot = (tx: number, ty: number, r: number, c: [number, number, number]): void => {
            const cx = tx * SCALE + SCALE / 2;
            const cy = ty * SCALE + SCALE / 2;
            for (let y = -r; y <= r; y++) {
                for (let x = -r; x <= r; x++) {
                    if (x * x + y * y <= r * r) {
                        set(Math.round(cx + x), Math.round(cy + y), c[0], c[1], c[2]);
                    }
                }
            }
        };

        // Base: region grass tint.
        const idx: Record<string, number> = { "P-S": 0, "B-B": 1, "C-P": 2, CARS: 3 };
        for (const r of plan.regions) {
            const pal = effectivePalettePreview(r.section);
            for (let ty = r.rect.y; ty < r.rect.y + r.rect.h; ty++) {
                for (let tx = r.rect.x; tx < r.rect.x + r.rect.w; tx++) {
                    cell(tx, ty, pal.grass);
                }
            }
        }
        // Plaza (center).
        for (const t of plan.center.plazaTiles) {
            cell(t.tileX, t.tileY, [216, 189, 149]);
        }
        // Water, trails, hedges.
        for (const r of plan.regions) {
            const pal = effectivePalettePreview(r.section);
            for (const t of r.waterTiles) {
                cell(t.tileX, t.tileY, pal.water);
            }
            for (const t of r.trailTiles) {
                cell(t.tileX, t.tileY, pal.path);
            }
            for (const t of r.landGaps) {
                cell(t.tileX, t.tileY, [150, 110, 70]);
            }
            for (const t of r.hedges) {
                cell(t.tileX, t.tileY, [40, 70, 40]);
            }
            // Fields (tulip/parterre).
            for (const f of r.fields) {
                for (let ty = Math.min(f.y0, f.y1); ty <= Math.max(f.y0, f.y1); ty++) {
                    for (let tx = Math.min(f.x0, f.x1); tx <= Math.max(f.x0, f.x1); tx++) {
                        cell(tx, ty, [230, 90, 120], 3);
                    }
                }
            }
            // Props (dark squares).
            for (const p of r.props) {
                cell(p.tileX, p.tileY, [90, 60, 40], 2);
            }
            // Waystone.
            dot(r.waystone.tileX, r.waystone.tileY, 4, [120, 90, 200]);
            // Plots (bright green rings) + a section-tint core.
            for (const p of r.plants) {
                dot(p.tileX, p.tileY, 5, [30, 30, 20]);
                dot(p.tileX, p.tileY, 4, [120 + idx[r.section] * 20, 200, 100]);
            }
            // Interactions (small cyan marks).
            for (const it of r.interactions) {
                dot(it.tileX, it.tileY, 2, [80, 230, 220]);
            }
        }
        // Gates (green=open-capable / red bar). Draw as small marks.
        for (const g of plan.gates) {
            dot(g.tileX, g.tileY, 3, [220, 70, 70]);
        }
        // Keeper (gold star-ish dot).
        dot(plan.center.keeperTile.tileX, plan.center.keeperTile.tileY, 6, [255, 224, 102]);

        const ppm = encodePpm(W, H, px);
        writeFileSync("/tmp/garden-preview.ppm", ppm);
        expect(ppm.length).toBeGreaterThan(100);
    });
});
