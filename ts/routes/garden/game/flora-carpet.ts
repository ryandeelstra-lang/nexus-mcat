// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the MERGED flower-bed painter ("everything doesn't merge" fix, 2026-07-03).
// Standalone per-tile clump sprites read as potted plants on a grid; the vision is
// continuous drifts — long unbroken ribbons of color. So bloomed ground is now painted
// the same way the terrain paints the world: dense painterly pixel blossoms drawn into
// canvas chunks, filling each tile edge-to-edge and flowing seamlessly into any
// same-species bloomed neighbor. Edges facing open grass erode organically (noise
// skirts), so a drift ends in a scalloped border, never a tile line. Sparse taller
// "hero" clumps (real art, flora-layer.ts) rise out of the carpet for sway/rustle life.
//
// The PAINTER is pure (paints RGBA buffers — node-testable, previewable); only the
// FloraCarpet class at the bottom touches Phaser canvas textures.
import type Phaser from "phaser";

import { floraHash, type FloraStage, type FlowerSpot } from "./flora";
import type { GardenSection } from "./worldgen";
import { TILE_SIZE } from "./worldgen";

// ---------------------------------------------------------------------------
// Palette derivation
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function splitTint(tint: number): RGB {
    return [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
}

function scale(c: RGB, f: number): RGB {
    return [
        Math.max(0, Math.min(255, Math.round(c[0] * f))),
        Math.max(0, Math.min(255, Math.round(c[1] * f))),
        Math.max(0, Math.min(255, Math.round(c[2] * f))),
    ];
}

function mix(a: RGB, b: RGB, t: number): RGB {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/** Foliage underlay per section — matches each region's grass family so beds sit IN the
 * grass, not on it. CARS runs near-black so the glowing blossoms carry the light. */
const LEAF_SHADES: Record<GardenSection, [RGB, RGB]> = {
    "P-S": [[78, 122, 58], [62, 101, 48]],
    "B-B": [[63, 107, 42], [50, 87, 34]],
    "C-P": [[58, 95, 30], [46, 78, 22]],
    "CARS": [[30, 58, 48], [21, 43, 36]],
};

export interface BedPalette {
    leaf: [RGB, RGB];
    /** Blossom shades: dark base, main, light, highlight. */
    bloom: [RGB, RGB, RGB, RGB];
}

export function bedPalette(spot: FlowerSpot): BedPalette {
    const tint = splitTint(spot.species.tint);
    const white: RGB = [255, 255, 250];
    return {
        leaf: LEAF_SHADES[spot.section],
        bloom: [
            scale(tint, 0.72),
            tint,
            mix(tint, white, 0.28),
            mix(tint, white, 0.62),
        ],
    };
}

// ---------------------------------------------------------------------------
// The pure cell painter
// ---------------------------------------------------------------------------

/** RGBA buffer the painter writes into (an ImageData look-alike). */
export interface CarpetBuffer {
    width: number;
    height: number;
    data: Uint8ClampedArray;
}

export function makeBuffer(width: number, height: number): CarpetBuffer {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Which of the four edges continue into a same-species bloomed neighbor (no erosion). */
export interface EdgeMask {
    n: boolean;
    e: boolean;
    s: boolean;
    w: boolean;
}

const PX = 2; // painted "pixel" block size, same chunkiness as the terrain painter

/** Max erosion depth (px) on an open edge — drifts end in scalloped skirts this deep. */
const SKIRT_MAX = 9;

/** Flower heads per fully-bloomed tile (each a chunky 4–6px blossom). */
const HEADS_BLOOM = 15;
/** Heads on a budding tile (sparse sprinkle of small closed buds). */
const HEADS_BUD = 4;

/** Cell clip rect — the painter NEVER writes outside its own tile (matches the Phaser
 * adapter's putImageData semantics, so pure and runtime renders are identical). */
interface Clip {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

function put(buf: CarpetBuffer, clip: Clip, x: number, y: number, c: RGB, a = 255): void {
    if (x < clip.x0 || y < clip.y0 || x >= clip.x1 || y >= clip.y1) {
        return;
    }
    if (x < 0 || y < 0 || x >= buf.width || y >= buf.height) {
        return;
    }
    const o = (y * buf.width + x) * 4;
    buf.data[o] = c[0];
    buf.data[o + 1] = c[1];
    buf.data[o + 2] = c[2];
    buf.data[o + 3] = a;
}

function putBlock(buf: CarpetBuffer, clip: Clip, x: number, y: number, c: RGB, a = 255): void {
    for (let dy = 0; dy < PX; dy++) {
        for (let dx = 0; dx < PX; dx++) {
            put(buf, clip, x + dx, y + dy, c, a);
        }
    }
}

/** Erosion test: is local px (lx,ly) inside the cell after open edges are noise-eroded?
 * Skirt depth varies along the edge (world-seeded), giving each drift a unique scallop. */
function insideEroded(
    spot: FlowerSpot,
    edges: EdgeMask,
    lx: number,
    ly: number,
): boolean {
    const wx = spot.tileX * TILE_SIZE + lx;
    const wy = spot.tileY * TILE_SIZE + ly;
    if (!edges.w && lx < SKIRT_MAX) {
        const depth = 2 + floraHash(spot.tileX * 97, wy >> 2, 1601) * (SKIRT_MAX - 2);
        if (lx < depth) {
            return false;
        }
    }
    if (!edges.e && lx >= TILE_SIZE - SKIRT_MAX) {
        const depth = 2 + floraHash(spot.tileX * 97 + 1, wy >> 2, 1602) * (SKIRT_MAX - 2);
        if (lx >= TILE_SIZE - depth) {
            return false;
        }
    }
    if (!edges.n && ly < SKIRT_MAX) {
        const depth = 2 + floraHash(wx >> 2, spot.tileY * 97, 1603) * (SKIRT_MAX - 2);
        if (ly < depth) {
            return false;
        }
    }
    if (!edges.s && ly >= TILE_SIZE - SKIRT_MAX) {
        const depth = 2 + floraHash(wx >> 2, spot.tileY * 97 + 1, 1604) * (SKIRT_MAX - 2);
        if (ly >= TILE_SIZE - depth) {
            return false;
        }
    }
    return true;
}

/** One chunky blossom head: a plus-shaped 6px cluster with a light crown + highlight. */
function paintHead(
    buf: CarpetBuffer,
    clip: Clip,
    x0: number,
    y0: number,
    pal: BedPalette,
    variant: number,
    small: boolean,
): void {
    const [dark, main, light, glint] = pal.bloom;
    let body = main;
    if (variant < 0.34) {
        body = dark;
    } else if (variant >= 0.78) {
        body = light;
    }
    if (small) {
        putBlock(buf, clip, x0, y0, body);
        put(buf, clip, x0, y0, glint);
        return;
    }
    // Plus shape: center block + four arms → reads as one round flower head.
    putBlock(buf, clip, x0, y0, body);
    putBlock(buf, clip, x0 - PX, y0, scale(body, 0.9));
    putBlock(buf, clip, x0 + PX, y0, scale(body, 0.9));
    putBlock(buf, clip, x0, y0 - PX, light);
    putBlock(buf, clip, x0, y0 + PX, scale(body, 0.82));
    put(buf, clip, x0, y0 - PX, glint);
    put(buf, clip, x0 + 1, y0, glint);
}

/**
 * Paint one tile's bed cell into the buffer at local origin (ox,oy). Deterministic per
 * world tile. `edges` = same-species bloomed neighbors (those sides run edge-to-edge and
 * merge seamlessly; open sides erode). Bud tiles get a sparse sprinkle, bloomed tiles a
 * full dense bed.
 */
export function paintBedCell(
    buf: CarpetBuffer,
    ox: number,
    oy: number,
    spot: FlowerSpot,
    stage: FloraStage,
    edges: EdgeMask,
): void {
    if (stage !== "bud" && stage !== "bloom") {
        return;
    }
    const pal = bedPalette(spot);
    const full = stage === "bloom";
    const wx0 = spot.tileX * TILE_SIZE;
    const wy0 = spot.tileY * TILE_SIZE;
    const clip: Clip = { x0: ox, y0: oy, x1: ox + TILE_SIZE, y1: oy + TILE_SIZE };

    // 1. Foliage underlay — dense leaf mat for blooms, patchy tufts for buds.
    for (let ly = 0; ly < TILE_SIZE; ly += PX) {
        for (let lx = 0; lx < TILE_SIZE; lx += PX) {
            if (!insideEroded(spot, edges, lx, ly)) {
                continue;
            }
            const n = floraHash(wx0 + lx, wy0 + ly, 1610);
            if (!full && n > 0.42) {
                continue; // patchy bud-stage mat
            }
            // A grass pixel may wink through in the INTERIOR only — border blocks stay
            // solid so joined cells knit into one seamless bed.
            const interior = lx >= PX && lx < TILE_SIZE - PX && ly >= PX && ly < TILE_SIZE - PX;
            if (full && interior && n > 0.95) {
                continue;
            }
            const shade = floraHash(wx0 + lx, wy0 + ly, 1611) < 0.6 ? pal.leaf[0] : pal.leaf[1];
            // Micro-variation so the mat never bands.
            const m = (floraHash(wx0 + lx, wy0 + ly, 1612) - 0.5) * 14;
            putBlock(buf, clip, ox + lx, oy + ly, [
                Math.max(0, Math.min(255, shade[0] + m)),
                Math.max(0, Math.min(255, shade[1] + m)),
                Math.max(0, Math.min(255, shade[2] + m)),
            ]);
        }
    }

    // 2. Blossom heads — chunky, clustered into little bouquets, deterministic. On sides
    // that continue into a same-species neighbor, heads may sit right on the shared edge
    // (the neighbor does the same), so rows knit together instead of leaving a seam.
    const heads = full ? HEADS_BLOOM : HEADS_BUD;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < heads; i++) {
        const minX = edges.w ? 0 : 3;
        const maxX = TILE_SIZE - (edges.e ? 2 : 8);
        const minY = edges.n ? 0 : 3;
        const maxY = TILE_SIZE - (edges.s ? 2 : 8);
        let hx: number;
        let hy: number;
        if (i % 3 === 0) {
            // A new bouquet anchor…
            hx = minX + Math.floor(floraHash(spot.tileX, spot.tileY, 1620 + i) * (maxX - minX));
            hy = minY + Math.floor(floraHash(spot.tileX, spot.tileY, 1650 + i) * (maxY - minY));
            cx = hx;
            cy = hy;
        } else {
            // …then satellites cluster 3–7px around it.
            hx = cx + Math.floor((floraHash(spot.tileX, spot.tileY, 1620 + i) - 0.5) * 12);
            hy = cy + Math.floor((floraHash(spot.tileX, spot.tileY, 1650 + i) - 0.5) * 12);
        }
        if (hx < minX || hx > maxX || hy < minY || hy > maxY) {
            continue;
        }
        if (!insideEroded(spot, edges, hx, hy)) {
            continue;
        }
        const variant = floraHash(spot.tileX, spot.tileY, 1680 + i);
        paintHead(buf, clip, ox + hx, oy + hy, pal, variant, !full);
    }

    // 3. CARS beds glitter — a few extra bright pixels so night drifts sparkle.
    if (full && spot.section === "CARS") {
        for (let i = 0; i < 6; i++) {
            const gx = 2 + Math.floor(floraHash(spot.tileX, spot.tileY, 1700 + i) * (TILE_SIZE - 4));
            const gy = 2 + Math.floor(floraHash(spot.tileX, spot.tileY, 1710 + i) * (TILE_SIZE - 4));
            if (insideEroded(spot, edges, gx, gy)) {
                put(buf, clip, ox + gx, oy + gy, pal.bloom[3]);
            }
        }
    }
}

/** Painted-pixel coverage of a cell region (test/tuning aid): fraction of opaque px. */
export function cellCoverage(
    buf: CarpetBuffer,
    ox: number,
    oy: number,
    size: number = TILE_SIZE,
): number {
    let painted = 0;
    for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
            const o = ((oy + ly) * buf.width + ox + lx) * 4;
            if (buf.data[o + 3] > 0) {
                painted++;
            }
        }
    }
    return painted / (size * size);
}

// ---------------------------------------------------------------------------
// Phaser adapter — chunked canvas textures, repainted per-cell.
// ---------------------------------------------------------------------------

/** Canvas chunk edge in world px (matches the terrain painter's chunking). */
const CHUNK = 960;
/** Carpet renders above the ground paint (-10) and below flat decals (-5). */
const CARPET_DEPTH = -6;

interface Chunk {
    key: string;
    x0: number;
    y0: number;
    texture: Phaser.Textures.CanvasTexture;
    dirty: boolean;
}

export class FloraCarpet {
    private scene: Phaser.Scene;
    private chunks = new Map<string, Chunk>();

    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }

    private chunkFor(wx: number, wy: number): Chunk | null {
        const cx0 = Math.floor(wx / CHUNK) * CHUNK;
        const cy0 = Math.floor(wy / CHUNK) * CHUNK;
        const key = `flora-carpet-${cx0}-${cy0}`;
        let chunk = this.chunks.get(key);
        if (!chunk) {
            // Fixed-size chunks; any overflow past the world edge stays transparent.
            const texture = this.scene.textures.createCanvas(key, CHUNK, CHUNK);
            if (!texture) {
                return null;
            }
            this.scene.add.image(cx0, cy0, key).setOrigin(0, 0).setDepth(CARPET_DEPTH);
            chunk = { key, x0: cx0, y0: cy0, texture, dirty: false };
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    /** (Re)paint one tile's bed cell. Call flush() after a batch. */
    paintCell(spot: FlowerSpot, stage: FloraStage, edges: EdgeMask): void {
        const wx = spot.tileX * TILE_SIZE;
        const wy = spot.tileY * TILE_SIZE;
        const chunk = this.chunkFor(wx, wy);
        if (!chunk) {
            return;
        }
        const buf = makeBuffer(TILE_SIZE, TILE_SIZE);
        paintBedCell(buf, 0, 0, spot, stage, edges);
        const ctx = chunk.texture.getContext();
        // Clear then draw — repaints (bud → bloom, new neighbor edges) never ghost.
        ctx.clearRect(wx - chunk.x0, wy - chunk.y0, TILE_SIZE, TILE_SIZE);
        ctx.putImageData(
            new ImageData(buf.data, TILE_SIZE, TILE_SIZE),
            wx - chunk.x0,
            wy - chunk.y0,
        );
        chunk.dirty = true;
    }

    /** Push all dirty chunks to the GPU (once per pour batch / boot). */
    flush(): void {
        for (const [, chunk] of this.chunks) {
            if (chunk.dirty) {
                chunk.texture.refresh();
                chunk.dirty = false;
            }
        }
    }

    destroy(): void {
        for (const [, chunk] of this.chunks) {
            this.scene.textures.remove(chunk.key);
        }
        this.chunks.clear();
    }
}
