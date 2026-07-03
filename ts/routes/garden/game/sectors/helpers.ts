// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: pure tile helpers for authoring sector layouts (rects, discs, lines) and for the
// framework (path rasterization, dedupe). No Phaser, fully deterministic, unit-testable.
import type { TileCoord } from "../worldgen";

function key(x: number, y: number): string {
    return `${x},${y}`;
}

/** Inclusive filled rectangle of tiles. */
export function rect(x0: number, y0: number, x1: number, y1: number): TileCoord[] {
    const out: TileCoord[] = [];
    const xa = Math.min(x0, x1);
    const xb = Math.max(x0, x1);
    const ya = Math.min(y0, y1);
    const yb = Math.max(y0, y1);
    for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
            out.push({ tileX: x, tileY: y });
        }
    }
    return out;
}

/** Filled disc of tiles (center + radius, in tiles). */
export function disc(cx: number, cy: number, r: number): TileCoord[] {
    const out: TileCoord[] = [];
    const c = Math.ceil(r);
    for (let dy = -c; dy <= c; dy++) {
        for (let dx = -c; dx <= c; dx++) {
            if (dx * dx + dy * dy <= r * r) {
                out.push({ tileX: Math.round(cx + dx), tileY: Math.round(cy + dy) });
            }
        }
    }
    return out;
}

/** Horizontal run of tiles at row `y`, x from x0..x1 inclusive. */
export function hline(y: number, x0: number, x1: number): TileCoord[] {
    const out: TileCoord[] = [];
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        out.push({ tileX: x, tileY: y });
    }
    return out;
}

/** Vertical run of tiles at column `x`, y from y0..y1 inclusive. */
export function vline(x: number, y0: number, y1: number): TileCoord[] {
    const out: TileCoord[] = [];
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        out.push({ tileX: x, tileY: y });
    }
    return out;
}

/** Concatenate tile lists. */
export function tiles(...lists: TileCoord[][]): TileCoord[] {
    return ([] as TileCoord[]).concat(...lists);
}

/** Deduplicate a tile list (stable order). */
export function dedupeTiles(list: TileCoord[]): TileCoord[] {
    const seen = new Set<string>();
    const out: TileCoord[] = [];
    for (const t of list) {
        const k = key(t.tileX, t.tileY);
        if (!seen.has(k)) {
            seen.add(k);
            out.push(t);
        }
    }
    return out;
}

/** Remove any tiles in `remove` from `list`. */
export function subtractTiles(list: TileCoord[], remove: TileCoord[]): TileCoord[] {
    const drop = new Set(remove.map((t) => key(t.tileX, t.tileY)));
    return list.filter((t) => !drop.has(key(t.tileX, t.tileY)));
}

/** 8-connected line between two integer tiles (Bresenham-style), inclusive. */
export function lineTiles(a: TileCoord, b: TileCoord): TileCoord[] {
    const out: TileCoord[] = [];
    let x0 = Math.round(a.tileX);
    let y0 = Math.round(a.tileY);
    const x1 = Math.round(b.tileX);
    const y1 = Math.round(b.tileY);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        out.push({ tileX: x0, tileY: y0 });
        if (x0 === x1 && y0 === y1) {
            break;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
            err += dy;
            x0 += sx;
        }
        if (e2 <= dx) {
            err += dx;
            y0 += sy;
        }
    }
    return out;
}

/** Rasterize a polyline (waypoint list) into a deduped 8-connected tile path. */
export function rasterizePath(waypoints: TileCoord[]): TileCoord[] {
    if (waypoints.length === 0) {
        return [];
    }
    const out: TileCoord[] = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        out.push(...lineTiles(waypoints[i], waypoints[i + 1]));
    }
    if (waypoints.length === 1) {
        out.push({ tileX: Math.round(waypoints[0].tileX), tileY: Math.round(waypoints[0].tileY) });
    }
    return dedupeTiles(out);
}
