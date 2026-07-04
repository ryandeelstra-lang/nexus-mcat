// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Overlook — the Super Depth Analysis floating island (docs/superpowers/
// specs/2026-07-03-depth-analysis-island-design.md). A small walkable island painted in
// its own sky rect EAST of the 44x32 world (east, not north: avatar depth is y/tile and
// ground sits at depth -10, so negative rows would draw the avatar under the island).
// The world-scene swaps camera bounds onto the sky rect on entry, so the void between
// world and island is never shown. Determinism (docs/26): all texture is hash2/fbm
// seeded noise with fresh salts (2201-2207) — no Math.random.

import type Phaser from "phaser";

import { DEPTH_STAT_ORDER } from "../state/depth-stats";
import { footBoxAt } from "./collision";
import { fbm, hash2 } from "./terrain";
import { TILE_SIZE } from "./worldgen";

export interface TilePoint {
    tileX: number;
    tileY: number;
}

export interface IslandPlan {
    /** The fully-painted sky rect (also the island camera bounds), in world tiles. */
    sky: { tileX: number; tileY: number; widthTiles: number; heightTiles: number };
    /** Walkable island tiles as "x,y" keys (everything else in the sky rect is air). */
    walkable: ReadonlySet<string>;
    /** Landing candidates, best first (south of the return stone). */
    arrival: TilePoint[];
    /** The way home — an active waystone at the island's heart. */
    returnStone: TilePoint;
    /** One monument per depth stat, ring-ordered; ids match DEPTH_STAT_ORDER. */
    statSpots: Array<TilePoint & { id: string }>;
}

/** Island body: authored row spans (tileY -> [x0, x1)), an organic blob around (61, 10). */
const ISLAND_ROWS: ReadonlyArray<[number, number, number]> = [
    // [tileY, startX, endX)
    [6, 58, 65],
    [7, 56, 67],
    [8, 55, 68],
    [9, 54, 69],
    [10, 54, 69],
    [11, 54, 69],
    [12, 55, 68],
    [13, 56, 67],
    [14, 58, 65],
];

/** Monument ring, clockwise from the arrival at the south rim. */
const MONUMENT_RING: ReadonlyArray<TilePoint> = [
    { tileX: 61, tileY: 14 },
    { tileX: 58, tileY: 13 },
    { tileX: 56, tileY: 12 },
    { tileX: 55, tileY: 10 },
    { tileX: 56, tileY: 8 },
    { tileX: 58, tileY: 7 },
    { tileX: 61, tileY: 6 },
    { tileX: 64, tileY: 7 },
    { tileX: 66, tileY: 8 },
    { tileX: 67, tileY: 10 },
    { tileX: 66, tileY: 12 },
    { tileX: 64, tileY: 13 },
];

export const ISLAND_TITLE = "The Overlook";
export const ISLAND_SUBTITLE = "Super Depth Analysis";

export function tileKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
}

export function buildIslandPlan(): IslandPlan {
    const walkable = new Set<string>();
    for (const [ty, x0, x1] of ISLAND_ROWS) {
        for (let tx = x0; tx < x1; tx++) {
            walkable.add(tileKey(tx, ty));
        }
    }
    return {
        sky: { tileX: 45, tileY: 0, widthTiles: 32, heightTiles: 20 },
        walkable,
        arrival: [
            { tileX: 61, tileY: 12 },
            { tileX: 60, tileY: 12 },
            { tileX: 62, tileY: 12 },
            { tileX: 61, tileY: 13 },
            { tileX: 60, tileY: 13 },
            { tileX: 62, tileY: 13 },
        ],
        returnStone: { tileX: 61, tileY: 10 },
        statSpots: DEPTH_STAT_ORDER.map((id, i) => ({ id, ...MONUMENT_RING[i] })),
    };
}

/** Is this world-pixel inside the island's sky rect? (The world-scene collision oracle
 * switches to island rules here — everything else outside the plan rect stays rimmed.) */
export function islandContainsPoint(plan: IslandPlan, x: number, y: number): boolean {
    const ts = TILE_SIZE;
    return x >= plan.sky.tileX * ts
        && x < (plan.sky.tileX + plan.sky.widthTiles) * ts
        && y >= plan.sky.tileY * ts
        && y < (plan.sky.tileY + plan.sky.heightTiles) * ts;
}

/** Island containment: the avatar's feet may only stand with all four foot-box corners
 * on walkable island tiles — the island supplies its OWN rim (the sky is not a floor). */
export function islandFootBlocked(plan: IslandPlan, x: number, y: number): boolean {
    const foot = footBoxAt(x, y);
    const corners = [
        [foot.left, foot.top],
        [foot.left + foot.w, foot.top],
        [foot.left, foot.top + foot.h],
        [foot.left + foot.w, foot.top + foot.h],
    ];
    for (const [px, py] of corners) {
        const tx = Math.floor(px / TILE_SIZE);
        const ty = Math.floor(py / TILE_SIZE);
        if (!plan.walkable.has(tileKey(tx, ty))) {
            return true;
        }
    }
    return false;
}

/** Camera bounds while on the island, in world px (== the painted sky rect). */
export function islandCameraBounds(
    plan: IslandPlan,
): { x: number; y: number; width: number; height: number } {
    const ts = TILE_SIZE;
    return {
        x: plan.sky.tileX * ts,
        y: plan.sky.tileY * ts,
        width: plan.sky.widthTiles * ts,
        height: plan.sky.heightTiles * ts,
    };
}

// ---------------------------------------------------------------------------
// Painter — one RGBA surface for the whole sky rect (pure; Phaser only at the seam).
// ---------------------------------------------------------------------------

/** Fresh noise salts for the Overlook (terrain owns 7..410, flora 1601..1710). */
const SALT_SKY = 2201;
const SALT_CLOUD = 2202;
const SALT_GRASS = 2203;
const SALT_ROCK = 2204;
const SALT_FLOWER = 2205;
const SALT_CLIFF = 2206;
const SALT_ROOT = 2207;

const BLOCK = 2;

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function skyColor(t: number, dither: number): [number, number, number] {
    // Airy day sky: deep blue up top, pale haze at the horizon band.
    const top: [number, number, number] = [127, 180, 221];
    const mid: [number, number, number] = [183, 214, 236];
    const low: [number, number, number] = [233, 241, 247];
    const c: [number, number, number] = t < 0.55
        ? [
            lerp(top[0], mid[0], t / 0.55),
            lerp(top[1], mid[1], t / 0.55),
            lerp(top[2], mid[2], t / 0.55),
        ]
        : [
            lerp(mid[0], low[0], (t - 0.55) / 0.45),
            lerp(mid[1], low[1], (t - 0.55) / 0.45),
            lerp(mid[2], low[2], (t - 0.55) / 0.45),
        ];
    return [c[0] + dither, c[1] + dither, c[2] + dither];
}

/** Distant sister islets (silhouettes only — haze-blue, no detail): tile-space ellipses. */
const ISLETS = [
    { cx: 49.5, cy: 15.5, rx: 1.7, ry: 0.65 },
    { cx: 74.0, cy: 4.5, rx: 1.2, ry: 0.5 },
];

export interface IslandSurface {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

/** Paint the whole sky rect: gradient sky + fbm clouds + sister islets + the island
 * (grass top with rim shading and flower flecks, banded-rock cliff underside with
 * hanging roots). Pure and deterministic — testable and previewable without Phaser. */
export function renderIslandSurface(plan: IslandPlan): IslandSurface {
    const ts = TILE_SIZE;
    const width = plan.sky.widthTiles * ts;
    const height = plan.sky.heightTiles * ts;
    const x0 = plan.sky.tileX * ts;
    const y0 = plan.sky.tileY * ts;
    const data = new Uint8ClampedArray(width * height * 4);

    // Per-column cliff depth below the island body: a smooth parabolic taper (deepest
    // under the middle — the classic floating-island root cone), edge-wobbled by low-
    // frequency noise so the underside reads hand-painted, never randomly dangling.
    const bottomByCol = new Map<number, number>();
    let minX = Infinity;
    let maxX = -Infinity;
    for (const [ty, colX0, colX1] of ISLAND_ROWS) {
        for (let tx = colX0; tx < colX1; tx++) {
            bottomByCol.set(tx, Math.max(bottomByCol.get(tx) ?? -Infinity, ty));
            minX = Math.min(minX, tx);
            maxX = Math.max(maxX, tx);
        }
    }
    const centerX = (minX + maxX) / 2;
    const halfSpan = Math.max(1, (maxX - minX) / 2);
    const cliffDepthPx = (wx: number): number => {
        const t = Math.min(1, Math.abs(wx / ts - centerX - 0.5) / (halfSpan + 0.5));
        const taper = 1 - t * t;
        return taper * 3.6 * ts + (fbm(wx * 0.05, 7, SALT_CLIFF) - 0.5) * ts * 0.9;
    };

    const walk = (tx: number, ty: number): boolean => plan.walkable.has(tileKey(tx, ty));

    for (let by = 0; by < height / BLOCK; by++) {
        for (let bx = 0; bx < width / BLOCK; bx++) {
            const wx = x0 + bx * BLOCK + 1;
            const wy = y0 + by * BLOCK + 1;
            const tx = Math.floor(wx / ts);
            const ty = Math.floor(wy / ts);
            let r: number;
            let g: number;
            let b: number;

            if (walk(tx, ty)) {
                // Grass top: low-frequency meadow mottling (terrain paints at these
                // scales — high frequency reads as static). Rim blocks darken.
                const meadow = (fbm(wx * 0.015, wy * 0.015, SALT_GRASS) - 0.5) * 26;
                const grain = (hash2(bx, by, SALT_GRASS + 1) - 0.5) * 7;
                const d = meadow + grain;
                const rim = !walk(Math.floor((wx - 5) / ts), ty)
                    || !walk(Math.floor((wx + 5) / ts), ty)
                    || !walk(tx, Math.floor((wy - 5) / ts))
                    || !walk(tx, Math.floor((wy + 5) / ts));
                if (rim) {
                    r = 74 + d;
                    g = 118 + d;
                    b = 62 + d;
                } else {
                    r = 106 + d;
                    g = 165 + d;
                    b = 90 + d;
                    // Flowers grow in drifts: a low-frequency gate opens patches, then
                    // sparse per-block picks fleck them white / soft pink / gold.
                    const drift = fbm(wx * 0.02, wy * 0.02, SALT_FLOWER);
                    if (drift > 0.58 && hash2(bx, by, SALT_FLOWER) < 0.06) {
                        const pick = hash2(by, bx, SALT_FLOWER + 1);
                        if (pick < 0.34) {
                            [r, g, b] = [243, 246, 249];
                        } else if (pick < 0.67) {
                            [r, g, b] = [249, 197, 213];
                        } else {
                            [r, g, b] = [255, 224, 102];
                        }
                    }
                }
            } else {
                const bottom = bottomByCol.get(tx);
                const depthPx = cliffDepthPx(wx);
                const intoCliff = bottom === undefined ? Infinity : wy - (bottom + 1) * ts;
                if (bottom !== undefined && intoCliff >= 0 && intoCliff < depthPx) {
                    // Cliff underside: soil lip, then low-frequency banded rock.
                    const band = fbm(wx * 0.012, wy * 0.02, SALT_ROCK);
                    const grain = (hash2(bx, by, SALT_ROCK + 1) - 0.5) * 8;
                    if (intoCliff < 5) {
                        r = 122 + grain;
                        g = 90 + grain;
                        b = 58 + grain;
                    } else if (band < 0.42) {
                        r = 82 + grain;
                        g = 64 + grain;
                        b = 46 + grain;
                    } else if (band < 0.66) {
                        r = 94 + grain;
                        g = 71 + grain;
                        b = 48 + grain;
                    } else {
                        r = 108 + grain;
                        g = 82 + grain;
                        b = 56 + grain;
                    }
                    // Hanging roots: sparse dark vertical streaks near the lip.
                    if (
                        intoCliff < ts * 1.4
                        && hash2(Math.floor(wx / 3), 11, SALT_ROOT) < 0.05
                    ) {
                        r = 63;
                        g = 44;
                        b = 26;
                    }
                    // Near the cone's tip, fade into the haze.
                    const tipT = intoCliff / depthPx;
                    if (tipT > 0.72) {
                        const fade = (tipT - 0.72) / 0.28;
                        r = lerp(r, 205, fade * 0.6);
                        g = lerp(g, 220, fade * 0.6);
                        b = lerp(b, 233, fade * 0.6);
                    }
                } else {
                    // Open sky: smooth gradient, gentle low-frequency shading, soft
                    // cumulus drifts, and two hazy sister islets.
                    const t = (wy - y0) / height;
                    const shade = (fbm(wx * 0.006, wy * 0.01, SALT_SKY) - 0.5) * 7;
                    [r, g, b] = skyColor(t, shade);
                    const cloud = fbm(wx * 0.008, wy * 0.022, SALT_CLOUD);
                    if (cloud > 0.56) {
                        const a = Math.min(1, (cloud - 0.56) * 5) * 0.9;
                        r = lerp(r, 247, a);
                        g = lerp(g, 250, a);
                        b = lerp(b, 253, a);
                    }
                    for (const islet of ISLETS) {
                        const ex = (wx / ts - islet.cx) / islet.rx;
                        const ey = (wy / ts - islet.cy) / islet.ry;
                        if (ex * ex + ey * ey <= 1) {
                            // A tiny far-off island: green cap, earthen cone, all hazed.
                            let cap: [number, number, number] = [134, 118, 100];
                            if (ey < -0.05) {
                                cap = [124, 163, 106];
                            } else if (ey > 0.55) {
                                cap = [112, 99, 84];
                            }
                            r = lerp(cap[0], r, 0.38);
                            g = lerp(cap[1], g, 0.38);
                            b = lerp(cap[2], b, 0.38);
                        }
                    }
                }
            }

            for (let py = 0; py < BLOCK; py++) {
                for (let px = 0; px < BLOCK; px++) {
                    const idx = ((by * BLOCK + py) * width + bx * BLOCK + px) * 4;
                    data[idx] = r;
                    data[idx + 1] = g;
                    data[idx + 2] = b;
                    data[idx + 3] = 255;
                }
            }
        }
    }
    return { width, height, data };
}

/** Blit the painted surface into the scene as one canvas texture (below terrain's -10 —
 * a separate area, but keep the band tidy). Called lazily on first island entry; the
 * texture is game-global, so a recreated scene just reattaches its image. */
export function paintIsland(scene: Phaser.Scene, plan: IslandPlan): void {
    const key = "overlook-island";
    if (!scene.textures.exists(key)) {
        const surface = renderIslandSurface(plan);
        const texture = scene.textures.createCanvas(key, surface.width, surface.height);
        if (!texture) {
            return;
        }
        texture.getContext().putImageData(
            new ImageData(surface.data, surface.width, surface.height),
            0,
            0,
        );
        texture.refresh();
    }
    const ts = TILE_SIZE;
    scene.add.image(plan.sky.tileX * ts, plan.sky.tileY * ts, key)
        .setOrigin(0, 0)
        .setDepth(-12);
}
