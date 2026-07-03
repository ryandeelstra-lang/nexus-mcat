// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: locks the authored sector layouts (docs/sectors/*) — the "Champions Island"
// composition contract. Every plot in its rect and beside a trail tile, plots spaced, water
// never under a plot, gates on the trail matching real prereq edges, interactions anchored.
import { describe, expect, it } from "vitest";

import { rasterizePath } from "./helpers";
import { SECTORS } from "./index";
import type { SectorLayout } from "./types";

import { LEAF_PREREQ, REGION_RECTS } from "../worldgen";

const rectFor = (section: string) => REGION_RECTS.find((r) => r.section === section)!;
const key = (x: number, y: number) => `${x},${y}`;

function trailSet(layout: SectorLayout): Set<string> {
    const s = new Set<string>();
    for (const wp of layout.pathWaypoints) {
        for (const t of rasterizePath(wp)) {
            s.add(key(t.tileX, t.tileY));
        }
    }
    for (const g of layout.landGaps) {
        s.add(key(g.tileX, g.tileY));
    }
    return s;
}

const authored = Object.values(SECTORS) as SectorLayout[];

describe("authored sectors", () => {
    it("registers all four great gardens", () => {
        expect(SECTORS["P-S"]).toBeDefined();
        expect(SECTORS["B-B"]).toBeDefined();
        expect(SECTORS["C-P"]).toBeDefined();
        expect(SECTORS.CARS).toBeDefined();
    });

    for (const layout of authored) {
        describe(layout.section, () => {
            const rect = rectFor(layout.section);
            const trail = trailSet(layout);
            const water = new Set(layout.waterTiles.map((t) => key(t.tileX, t.tileY)));
            const gaps = new Set(layout.landGaps.map((t) => key(t.tileX, t.tileY)));

            it("plots lie inside the region rect", () => {
                for (const p of layout.plots) {
                    expect(p.tileX).toBeGreaterThanOrEqual(rect.x);
                    expect(p.tileX).toBeLessThan(rect.x + rect.w);
                    expect(p.tileY).toBeGreaterThanOrEqual(rect.y);
                    expect(p.tileY).toBeLessThan(rect.y + rect.h);
                }
            });

            it("no plot sits on a water tile (land-gaps excepted)", () => {
                for (const p of layout.plots) {
                    const k = key(p.tileX, p.tileY);
                    expect(water.has(k) && !gaps.has(k)).toBe(false);
                }
            });

            it("every plot is orthogonally adjacent to a trail tile", () => {
                for (const p of layout.plots) {
                    const adj = [
                        key(p.tileX + 1, p.tileY),
                        key(p.tileX - 1, p.tileY),
                        key(p.tileX, p.tileY + 1),
                        key(p.tileX, p.tileY - 1),
                    ];
                    expect(adj.some((a) => trail.has(a))).toBe(true);
                }
            });

            it("plots are >=3 tiles apart", () => {
                for (let i = 0; i < layout.plots.length; i++) {
                    for (let j = i + 1; j < layout.plots.length; j++) {
                        const a = layout.plots[i];
                        const b = layout.plots[j];
                        const d = Math.hypot(a.tileX - b.tileX, a.tileY - b.tileY);
                        expect(d).toBeGreaterThanOrEqual(3);
                    }
                }
            });

            it("every gate sits on a trail tile", () => {
                for (const g of layout.gates) {
                    expect(trail.has(key(g.tileX, g.tileY))).toBe(true);
                }
            });

            it("every gate is a real in-region prereq edge between two of its plots", () => {
                const plotIds = new Set(layout.plots.map((p) => p.nodeId));
                const prereq = new Set(LEAF_PREREQ.map((e) => `${e.src}->${e.dst}`));
                for (const g of layout.gates) {
                    expect(plotIds.has(g.src)).toBe(true);
                    expect(plotIds.has(g.dst)).toBe(true);
                    expect(prereq.has(`${g.src}->${g.dst}`)).toBe(true);
                }
            });
        });
    }
});
