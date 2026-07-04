// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: merged-bed painter invariants (the "everything doesn't merge" fix,
// 2026-07-03) — deterministic cells, dense bloom coverage, sparse bud sprinkle,
// seamless edges toward same-species neighbors vs eroded organic skirts toward
// open grass, and the hero-tile sparsity that keeps drifts continuous.
import { describe, expect, it } from "vitest";

import { allFloraSpecies, bedEdges, floraKey, type FloraLayout, type FlowerSpot, isHeroTile } from "./flora";
import { cellCoverage, type EdgeMask, makeBuffer, paintBedCell } from "./flora-carpet";
import { TILE_SIZE } from "./worldgen";

const SPECIES = allFloraSpecies()[0];

function spot(tileX: number, tileY: number, section: FlowerSpot["section"] = "P-S"): FlowerSpot {
    return { tileX, tileY, section, species: SPECIES, watersNeeded: 4, bandId: `${section}:0` };
}

const OPEN: EdgeMask = { n: false, e: false, s: false, w: false };
const JOINED: EdgeMask = { n: true, e: true, s: true, w: true };

function paint(s: FlowerSpot, stage: "bud" | "bloom", edges: EdgeMask) {
    const buf = makeBuffer(TILE_SIZE, TILE_SIZE);
    paintBedCell(buf, 0, 0, s, stage, edges);
    return buf;
}

/** Painted fraction of a 1px-wide edge strip. */
function edgeStrip(buf: ReturnType<typeof makeBuffer>, edge: "n" | "e" | "s" | "w"): number {
    const coordFor: Record<"n" | "e" | "s" | "w", (i: number) => [number, number]> = {
        n: (i) => [i, 0],
        s: (i) => [i, TILE_SIZE - 1],
        w: (i) => [0, i],
        e: (i) => [TILE_SIZE - 1, i],
    };
    let painted = 0;
    for (let i = 0; i < TILE_SIZE; i++) {
        const [x, y] = coordFor[edge](i);
        if (buf.data[(y * buf.width + x) * 4 + 3] > 0) {
            painted++;
        }
    }
    return painted / TILE_SIZE;
}

describe("paintBedCell — the merged flower bed", () => {
    it("is deterministic per world tile", () => {
        const a = paint(spot(7, 9), "bloom", OPEN);
        const b = paint(spot(7, 9), "bloom", OPEN);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
        // …and different tiles paint differently (no stamped repetition).
        const c = paint(spot(8, 9), "bloom", OPEN);
        expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
    });

    it("bloom cells are dense beds; bud cells a light sprinkle; sprout/none paint nothing", () => {
        const bloom = cellCoverage(paint(spot(5, 5), "bloom", JOINED), 0, 0);
        const bud = cellCoverage(paint(spot(5, 5), "bud", JOINED), 0, 0);
        expect(bloom).toBeGreaterThan(0.75);
        expect(bud).toBeGreaterThan(0.2);
        expect(bud).toBeLessThan(bloom * 0.85);
        const none = makeBuffer(TILE_SIZE, TILE_SIZE);
        paintBedCell(none, 0, 0, spot(5, 5), "sprout", OPEN);
        expect(cellCoverage(none, 0, 0)).toBe(0);
    });

    it("joined edges run edge-to-edge (seamless merge); open edges erode organically", () => {
        const joined = paint(spot(11, 4), "bloom", JOINED);
        for (const e of ["n", "e", "s", "w"] as const) {
            expect(edgeStrip(joined, e), `joined ${e} edge should be nearly full`)
                .toBeGreaterThan(0.85);
        }
        const open = paint(spot(11, 4), "bloom", OPEN);
        for (const e of ["n", "e", "s", "w"] as const) {
            expect(edgeStrip(open, e), `open ${e} edge should be eroded`).toBeLessThan(0.15);
        }
        // Mixed: the joined side reaches the border along its MIDDLE band (the open
        // n/s edges legitimately scallop the corners of the column).
        const mixed = paint(spot(11, 4), "bloom", { n: false, e: true, s: false, w: false });
        let middlePainted = 0;
        const bandStart = 10;
        const bandEnd = TILE_SIZE - 10;
        for (let y = bandStart; y < bandEnd; y++) {
            if (mixed.data[(y * mixed.width + (TILE_SIZE - 1)) * 4 + 3] > 0) {
                middlePainted++;
            }
        }
        expect(middlePainted / (bandEnd - bandStart)).toBeGreaterThan(0.95);
        expect(edgeStrip(mixed, "w")).toBeLessThan(0.15);
    });

    it("two same-species neighbors form one continuous bed across their shared border", () => {
        // Paint two tiles of a ROW (n/s edges also joined, as inside a band) into one
        // wide buffer; the two columns astride the border must both be densely painted —
        // no visible seam gap anywhere down the shared edge.
        const buf = makeBuffer(TILE_SIZE * 2, TILE_SIZE);
        const left = spot(20, 8);
        const right = spot(21, 8);
        paintBedCell(buf, 0, 0, left, "bloom", { n: true, s: true, e: true, w: false });
        paintBedCell(buf, TILE_SIZE, 0, right, "bloom", { n: true, s: true, e: false, w: true });
        let seamPainted = 0;
        for (let y = 0; y < TILE_SIZE; y++) {
            const l = buf.data[(y * buf.width + (TILE_SIZE - 1)) * 4 + 3] > 0;
            const r = buf.data[(y * buf.width + TILE_SIZE) * 4 + 3] > 0;
            if (l && r) {
                seamPainted++;
            }
        }
        expect(seamPainted / TILE_SIZE).toBeGreaterThan(0.95);
    });

    it("never paints outside its own cell", () => {
        const buf = makeBuffer(TILE_SIZE * 3, TILE_SIZE * 3);
        paintBedCell(buf, TILE_SIZE, TILE_SIZE, spot(30, 12), "bloom", JOINED);
        let outside = 0;
        for (let y = 0; y < buf.height; y++) {
            for (let x = 0; x < buf.width; x++) {
                const inCell = x >= TILE_SIZE && x < TILE_SIZE * 2 && y >= TILE_SIZE && y < TILE_SIZE * 2;
                if (!inCell && buf.data[(y * buf.width + x) * 4 + 3] > 0) {
                    outside++;
                }
            }
        }
        expect(outside).toBe(0);
    });
});

describe("hero sparsity + bed edges", () => {
    it("isHeroTile is deterministic and roughly matches each species' heroDensity", { timeout: 20_000 }, () => {
        // Aggregate-then-assert (per-iteration expect() calls time out under full-suite
        // load): two full passes must agree exactly, and each species' hero rate must sit
        // near its configured density while staying a small minority (drifts must merge).
        const N = 2000;
        for (const species of allFloraSpecies()) {
            let heroes = 0;
            let mismatches = 0;
            for (let i = 0; i < N; i++) {
                const s: FlowerSpot = {
                    tileX: i % 80,
                    tileY: Math.floor(i / 80),
                    section: "P-S",
                    species,
                    watersNeeded: 4,
                    bandId: "P-S:0",
                };
                const first = isHeroTile(s);
                if (first !== isHeroTile(s)) {
                    mismatches++;
                }
                if (first) {
                    heroes++;
                }
            }
            const rate = heroes / N;
            expect(mismatches, `${species.id} nondeterministic`).toBe(0);
            expect(rate, `${species.id} rate too low`).toBeGreaterThan(species.heroDensity * 0.6);
            expect(rate, `${species.id} rate too high`).toBeLessThan(species.heroDensity * 1.5);
            expect(rate, `${species.id} heroes must stay a minority`).toBeLessThan(0.4);
        }
    });

    it("bedEdges joins only grown same-species neighbors", () => {
        const a = spot(10, 10);
        const b = spot(11, 10); // same species, east
        const other: FlowerSpot = { ...spot(9, 10), species: allFloraSpecies()[1] };
        const layout: FloraLayout = {
            spots: new Map([
                [floraKey(10, 10), a],
                [floraKey(11, 10), b],
                [floraKey(9, 10), other],
            ]),
            bands: new Map([["P-S:0", [floraKey(10, 10), floraKey(11, 10), floraKey(9, 10)]]]),
        };
        // Nothing grown: no joins.
        expect(bedEdges(layout, {}, a)).toEqual({ n: false, e: false, s: false, w: false });
        // East neighbor at bud: join east. West neighbor is another species: never joins.
        const counts = { [floraKey(11, 10)]: 2, [floraKey(9, 10)]: 4 };
        expect(bedEdges(layout, counts, a)).toEqual({ n: false, e: true, s: false, w: false });
    });
});
