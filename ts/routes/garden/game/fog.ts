// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the one-time onboarding fog (2026-07-03 directive). The island boots fully
// shrouded except the Keeper's center plaza; finishing the placement test with the master
// lifts the whole shroud for good. NOT flat rectangles: the scene paints a full-island
// canvas texture whose per-pixel alpha is a smooth distance-to-plaza falloff multiplied by
// layered value noise, so the mist reads soft and wispy. This module is the pure math
// (distance, density, noise, the plaza leash) so every ingredient is unit-testable;
// world-scene owns the canvas + sprites.

export interface TileRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Euclidean distance from a point to a rect's edge, 0 inside (tile units throughout). */
export function distanceToRect(x: number, y: number, r: TileRect): number {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    return Math.hypot(dx, dy);
}

/** The classic smoothstep: 0 at or below `lo`, 1 at or above `hi`, C1-smooth between. */
export function smoothstep(lo: number, hi: number, v: number): number {
    const t = Math.min(Math.max((v - lo) / (hi - lo), 0), 1);
    return t * t * (3 - 2 * t);
}

/**
 * Fog density 0..1 at a world tile position: clear (0) inside the plaza, rising smoothly
 * to full shroud across `falloff` tiles. The scene multiplies this by noise for wisps.
 */
export function fogDensityAt(
    x: number,
    y: number,
    clear: TileRect,
    falloff: number,
): number {
    return smoothstep(0, falloff, distanceToRect(x, y, clear));
}

/** Deterministic 2D lattice hash -> [0, 1) (the classic integer-mix construction). */
export function hash2(ix: number, iy: number, seed: number): number {
    let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** Bilinear value noise at (x, y) for one octave, range [0, 1). Deterministic per seed. */
function valueNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * Layered (fractal) value noise, ~[0, 1]: three octaves of soft blobs — the cloud body.
 * `scale` is the feature size in the caller's units (tiles): bigger scale = bigger clouds.
 */
export function cloudNoise(x: number, y: number, scale: number, seed: number): number {
    const n = valueNoise(x / scale, y / scale, seed) * 0.55
        + valueNoise(x / scale * 2.3, y / scale * 2.3, seed + 1) * 0.3
        + valueNoise(x / scale * 5.1, y / scale * 5.1, seed + 2) * 0.15;
    return Math.min(1, Math.max(0, n));
}

/**
 * Clamp the avatar's FEET anchor (world px; sprites anchor at the feet, and the tile
 * under the avatar is read half a tile above the anchor) so the player cannot wander
 * blind into the shroud. `inset` keeps the clamp strictly inside the rect edge.
 */
export function clampFeetToTileRect(
    x: number,
    y: number,
    rect: TileRect,
    tile: number,
    inset = 2,
): { x: number; y: number } {
    const minX = rect.x * tile + inset;
    const maxX = (rect.x + rect.w) * tile - inset;
    const minY = rect.y * tile + tile * 0.5 + inset;
    const maxY = (rect.y + rect.h) * tile - inset;
    return {
        x: Math.min(Math.max(x, minX), maxX),
        y: Math.min(Math.max(y, minY), maxY),
    };
}
