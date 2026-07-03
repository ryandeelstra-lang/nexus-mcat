// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: organic terrain for the overworld (doc 23 §9.3). Replaces the per-tile
// checkerboard with ONE painted ground surface — noise-dappled grass, wavy dithered region
// borders, winding gravel paths, organic ponds with shorelines — plus a deterministic
// decoration scatter (trees / bushes / flowers clustered by species). The goal: the world
// reads as a hand-painted cozy island, never as a visible 32px grid.
//
// buildTerrainModel + planDecor are pure (testable, deterministic); only paintGround
// touches Phaser.
import type Phaser from "phaser";

import { DISPLAY, hasAssetKey } from "./assets";
import { sectorFor } from "./sectors/index";
import type { PaletteOverride } from "./sectors/types";
import {
    type GardenSection,
    hedgeTilesForRegion,
    KEEPER_TILE,
    type RegionPlan,
    SPLIT_X,
    SPLIT_Y,
    type TileCoord,
    type WorldPlan,
} from "./worldgen";

const TILE = DISPLAY.tile;
/** Painted "pixel" size in world px — chunky, reads as pixel art at camera zoom 2. */
const BLOCK = 2;
/** Distance-field resolution in world px. */
const GRID = 8;
/** Canvas chunk edge in world px (keeps single textures small). */
const CHUNK = 960;

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed, 1440662683);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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

function fbm(x: number, y: number, seed: number): number {
    return 0.6 * valueNoise(x, y, seed)
        + 0.3 * valueNoise(x * 2.13, y * 2.13, seed + 101)
        + 0.1 * valueNoise(x * 4.31, y * 4.31, seed + 202);
}

// ---------------------------------------------------------------------------
// Terrain model — distance fields + region field
// ---------------------------------------------------------------------------

export interface TerrainModel {
    gw: number;
    gh: number;
    /** Distance (world px) to nearest water tile. */
    waterDT: Float32Array;
    /** Distance (world px) to nearest trail tile or connector path. */
    trailDT: Float32Array;
    /** Region index per grid cell: 0 P-S · 1 B-B · 2 C-P · 3 CARS. */
    regionOfCell: Uint8Array;
}

const REGION_INDEX = { "P-S": 0, "B-B": 1, "C-P": 2, CARS: 3 } as const;

function chamferDT(seeds: Uint8Array, gw: number, gh: number): Float32Array {
    const INF = 1e9;
    const d = new Float32Array(gw * gh);
    for (let i = 0; i < d.length; i++) {
        d[i] = seeds[i] ? 0 : INF;
    }
    for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
            const i = y * gw + x;
            let v = d[i];
            if (x > 0) {
                v = Math.min(v, d[i - 1] + 3);
            }
            if (y > 0) {
                v = Math.min(v, d[i - gw] + 3);
                if (x > 0) {
                    v = Math.min(v, d[i - gw - 1] + 4);
                }
                if (x < gw - 1) {
                    v = Math.min(v, d[i - gw + 1] + 4);
                }
            }
            d[i] = v;
        }
    }
    for (let y = gh - 1; y >= 0; y--) {
        for (let x = gw - 1; x >= 0; x--) {
            const i = y * gw + x;
            let v = d[i];
            if (x < gw - 1) {
                v = Math.min(v, d[i + 1] + 3);
            }
            if (y < gh - 1) {
                v = Math.min(v, d[i + gw] + 3);
                if (x < gw - 1) {
                    v = Math.min(v, d[i + gw + 1] + 4);
                }
                if (x > 0) {
                    v = Math.min(v, d[i + gw - 1] + 4);
                }
            }
            d[i] = v;
        }
    }
    for (let i = 0; i < d.length; i++) {
        d[i] = (d[i] / 3) * GRID;
    }
    return d;
}

export function sampleDT(
    dt: Float32Array,
    gw: number,
    gh: number,
    px: number,
    py: number,
): number {
    const gx = Math.min(Math.max(px / GRID - 0.5, 0), gw - 1.001);
    const gy = Math.min(Math.max(py / GRID - 0.5, 0), gh - 1.001);
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const i = iy * gw + ix;
    const x1 = Math.min(ix + 1, gw - 1) - ix;
    const y1 = (Math.min(iy + 1, gh - 1) - iy) * gw;
    const a = dt[i];
    const b = dt[i + x1];
    const c = dt[i + y1];
    const d = dt[i + y1 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Wavy connector path from the Keeper plaza to a region's nearest trail tile. */
function connectorPoints(region: RegionPlan): Array<{ x: number; y: number }> {
    let best: TileCoord | null = null;
    let bestD = Infinity;
    for (const t of region.trailTiles) {
        const d = Math.hypot(t.tileX - KEEPER_TILE.tileX, t.tileY - KEEPER_TILE.tileY);
        if (d < bestD) {
            bestD = d;
            best = t;
        }
    }
    if (!best) {
        return [];
    }
    const from = { x: KEEPER_TILE.tileX + 0.5, y: KEEPER_TILE.tileY + 0.5 };
    const to = { x: best.tileX + 0.5, y: best.tileY + 0.5 };
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(2, Math.ceil(len * 2));
    const perpX = -(to.y - from.y) / len;
    const perpY = (to.x - from.x) / len;
    const phase = hash2(best.tileX, best.tileY, 7) * Math.PI * 2;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wobble = Math.sin(t * Math.PI * 2 * 1.4 + phase) * Math.sin(t * Math.PI) * 1.4;
        pts.push({
            x: from.x + (to.x - from.x) * t + perpX * wobble,
            y: from.y + (to.y - from.y) * t + perpY * wobble,
        });
    }
    return pts;
}

export function buildTerrainModel(plan: WorldPlan): TerrainModel {
    const wpx = plan.widthTiles * TILE;
    const hpx = plan.heightTiles * TILE;
    const gw = Math.ceil(wpx / GRID);
    const gh = Math.ceil(hpx / GRID);
    const waterSeeds = new Uint8Array(gw * gh);
    const trailSeeds = new Uint8Array(gw * gh);
    const perTile = TILE / GRID;

    const markTile = (arr: Uint8Array, tx: number, ty: number, inset: number): void => {
        const x0 = Math.max(0, tx * perTile + inset);
        const y0 = Math.max(0, ty * perTile + inset);
        const x1 = Math.min(gw - 1, (tx + 1) * perTile - 1 - inset);
        const y1 = Math.min(gh - 1, (ty + 1) * perTile - 1 - inset);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                arr[y * gw + x] = 1;
            }
        }
    };

    for (const r of plan.regions) {
        for (const t of r.waterTiles) {
            markTile(waterSeeds, t.tileX, t.tileY, 0);
        }
        for (const t of r.trailTiles) {
            markTile(trailSeeds, t.tileX, t.tileY, 1);
        }
        for (const p of connectorPoints(r)) {
            const gx = Math.round((p.x * TILE) / GRID);
            const gy = Math.round((p.y * TILE) / GRID);
            if (gx >= 0 && gx < gw && gy >= 0 && gy < gh) {
                trailSeeds[gy * gw + gx] = 1;
            }
        }
    }

    const regionOfCell = new Uint8Array(gw * gh);
    const wob = 2.8 * TILE;
    for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
            const px = (gx + 0.5) * GRID;
            const py = (gy + 0.5) * GRID;
            const wx = px + (fbm(px * 0.0035, py * 0.0035, 21) - 0.5) * 2 * wob;
            const wy = py + (fbm(px * 0.0035 + 40, py * 0.0035 + 40, 22) - 0.5) * 2 * wob;
            const east = wx > SPLIT_X * TILE;
            const south = wy > SPLIT_Y * TILE;
            if (east) {
                regionOfCell[gy * gw + gx] = south ? 3 : 1;
            } else {
                regionOfCell[gy * gw + gx] = south ? 2 : 0;
            }
        }
    }

    return {
        gw,
        gh,
        waterDT: chamferDT(waterSeeds, gw, gh),
        trailDT: chamferDT(trailSeeds, gw, gh),
        regionOfCell,
    };
}

// ---------------------------------------------------------------------------
// Ground painting
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function rgb(hex: string): RGB {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

interface GroundPalette {
    grass: [RGB, RGB, RGB];
    tuft: RGB;
    flowers: RGB[];
    flowerDensity: number;
    pebble: RGB;
    path: [RGB, RGB];
    pathRim: RGB;
    waterDeep: RGB;
    water: RGB;
    waterLight: RGB;
    shore: RGB;
}

/** Index matches REGION_INDEX: sakura · keukenhof · versailles · gardens-by-the-bay. */
const PALETTES: GroundPalette[] = [
    {
        grass: [rgb("#8CA84B"), rgb("#829E45"), rgb("#76913D")],
        tuft: rgb("#5E7A33"),
        flowers: [rgb("#F2A9C4"), rgb("#F7C9D9"), rgb("#E87EA1")],
        flowerDensity: 0.008,
        pebble: rgb("#9B9484"),
        path: [rgb("#CDB086"), rgb("#C0A276")],
        pathRim: rgb("#98805A"),
        waterDeep: rgb("#1B5B6B"),
        water: rgb("#2E7A8C"),
        waterLight: rgb("#4FA0B2"),
        shore: rgb("#CBB289"),
    },
    {
        grass: [rgb("#83942F"), rgb("#78892B"), rgb("#6C7E27")],
        tuft: rgb("#556C22"),
        flowers: [rgb("#D8484A"), rgb("#E7B33C"), rgb("#B76BD1"), rgb("#F2F2E4")],
        flowerDensity: 0.008,
        pebble: rgb("#96907C"),
        path: [rgb("#9A5A41"), rgb("#8A4E38")],
        pathRim: rgb("#63382A"),
        waterDeep: rgb("#0F5273"),
        water: rgb("#1D6D8E"),
        waterLight: rgb("#4FA3BE"),
        shore: rgb("#B99F76"),
    },
    {
        grass: [rgb("#5C7D14"), rgb("#527510"), rgb("#486C0D")],
        tuft: rgb("#3B5B09"),
        flowers: [rgb("#F2E6C4"), rgb("#E7C860")],
        flowerDensity: 0.004,
        pebble: rgb("#8F8A74"),
        path: [rgb("#E2C593"), rgb("#D6B681")],
        pathRim: rgb("#AE9166"),
        waterDeep: rgb("#28578B"),
        water: rgb("#3A6EA5"),
        waterLight: rgb("#7BA7D2"),
        shore: rgb("#D9BE8E"),
    },
    {
        grass: [rgb("#2C4736"), rgb("#26402F"), rgb("#203828")],
        tuft: rgb("#16281E"),
        flowers: [rgb("#3E9C8B"), rgb("#6E48A8"), rgb("#2E7FA0")],
        flowerDensity: 0.0025,
        pebble: rgb("#3E4A41"),
        path: [rgb("#7B5742"), rgb("#6A4838")],
        pathRim: rgb("#46312A"),
        waterDeep: rgb("#07223A"),
        water: rgb("#0E3450"),
        waterLight: rgb("#2A7A99"),
        shore: rgb("#3E4F44"),
    },
];

/** Section per region index (mirrors REGION_INDEX) for palette-override lookup. */
const SECTION_BY_INDEX: GardenSection[] = ["P-S", "B-B", "C-P", "CARS"];

function mergePalette(base: GroundPalette, o: PaletteOverride): GroundPalette {
    return {
        grass: o.grass ? [rgb(o.grass[0]), rgb(o.grass[1]), rgb(o.grass[2])] : base.grass,
        tuft: o.tuft ? rgb(o.tuft) : base.tuft,
        flowers: o.flowers ? o.flowers.map(rgb) : base.flowers,
        flowerDensity: o.flowerDensity ?? base.flowerDensity,
        pebble: o.pebble ? rgb(o.pebble) : base.pebble,
        path: o.path ? [rgb(o.path[0]), rgb(o.path[1])] : base.path,
        pathRim: o.pathRim ? rgb(o.pathRim) : base.pathRim,
        waterDeep: o.waterDeep ? rgb(o.waterDeep) : base.waterDeep,
        water: o.water ? rgb(o.water) : base.water,
        waterLight: o.waterLight ? rgb(o.waterLight) : base.waterLight,
        shore: o.shore ? rgb(o.shore) : base.shore,
    };
}

/** The palettes with authored-sector overrides applied (deterministic). */
function effectivePalettes(): GroundPalette[] {
    return PALETTES.map((base, i) => {
        const layout = sectorFor(SECTION_BY_INDEX[i]);
        return layout?.palette ? mergePalette(base, layout.palette) : base;
    });
}

const PLAZA_FILL: [RGB, RGB] = [rgb("#D8BD95"), rgb("#CDB086")];
const PLAZA_RIM: RGB = rgb("#A38B62");

const KEEPER_PX = { x: (KEEPER_TILE.tileX + 0.5) * TILE, y: (KEEPER_TILE.tileY + 0.5) * TILE };
const PLAZA_RX = 5.2 * TILE;
const PLAZA_RY = 3.9 * TILE;

/** Noise-wobbled plaza ellipse test: < 1 means inside. */
export function plazaField(px: number, py: number): number {
    const dx = (px - KEEPER_PX.x) / PLAZA_RX;
    const dy = (py - KEEPER_PX.y) / PLAZA_RY;
    return dx * dx + dy * dy + (fbm(px * 0.008, py * 0.008, 41) - 0.5) * 0.3;
}

/** Paint the whole overworld ground into chunked canvas textures (below all sprites). */
export function paintGround(scene: Phaser.Scene, plan: WorldPlan, model: TerrainModel): void {
    const wpx = plan.widthTiles * TILE;
    const hpx = plan.heightTiles * TILE;
    const { gw, gh, waterDT, trailDT, regionOfCell } = model;
    const palettes = effectivePalettes();

    for (let cy0 = 0; cy0 < hpx; cy0 += CHUNK) {
        for (let cx0 = 0; cx0 < wpx; cx0 += CHUNK) {
            const cw = Math.min(CHUNK, wpx - cx0);
            const ch = Math.min(CHUNK, hpx - cy0);
            const key = `ground-${cx0}-${cy0}`;
            if (scene.textures.exists(key)) {
                scene.textures.remove(key);
            }
            const tex = scene.textures.createCanvas(key, cw, ch);
            if (!tex) {
                continue;
            }
            const ctx = tex.getContext();
            const img = ctx.createImageData(cw, ch);
            const data = img.data;

            for (let by = 0; by < ch; by += BLOCK) {
                for (let bx = 0; bx < cw; bx += BLOCK) {
                    const px = cx0 + bx + 1;
                    const py = cy0 + by + 1;

                    // Region with dithered/wavy borders.
                    let gx = Math.min(gw - 1, (px / GRID) | 0);
                    let gy = Math.min(gh - 1, (py / GRID) | 0);
                    const dth = hash2(px, py, 91);
                    if (dth < 0.18) {
                        gx = Math.min(gw - 1, Math.max(0, gx + (dth < 0.09 ? 1 : -1)));
                    } else if (dth > 0.82) {
                        gy = Math.min(gh - 1, Math.max(0, gy + (dth > 0.91 ? 1 : -1)));
                    }
                    const pal = palettes[regionOfCell[gy * gw + gx]];

                    const wd = sampleDT(waterDT, gw, gh, px, py);
                    const td = sampleDT(trailDT, gw, gh, px, py);
                    const edgeJ = (hash2(px, py, 17) - 0.5) * 6;

                    let color: RGB;
                    const waterW = TILE * 0.72
                        + (fbm(px * 0.01, py * 0.01, 31) - 0.5) * TILE * 0.35;

                    if (wd + edgeJ < waterW) {
                        if (wd + edgeJ < waterW - 10) {
                            color = wd < waterW * 0.45 ? pal.waterDeep : pal.water;
                            const rip = fbm(px * 0.008, py * 0.045, 121);
                            if (rip > 0.6 && rip < 0.645) {
                                color = pal.waterLight;
                            }
                        } else {
                            color = pal.waterLight;
                        }
                    } else if (wd + edgeJ < waterW + 9) {
                        const s = hash2(px, py, 33) < 0.5 ? 0 : 8;
                        color = [pal.shore[0] - s, pal.shore[1] - s, pal.shore[2] - s];
                    } else {
                        const pe = plazaField(px, py);
                        if (pe < 1) {
                            const f = PLAZA_FILL[hash2(px, py, 55) < 0.5 ? 0 : 1];
                            color = pe > 0.84 ? PLAZA_RIM : f;
                            if (hash2(px, py, 56) < 0.02) {
                                color = PLAZA_RIM;
                            }
                        } else {
                            const pathW = TILE * 0.62
                                + (fbm(px * 0.012, py * 0.012, 51) - 0.5) * TILE * 0.3;
                            if (td + edgeJ < pathW) {
                                if (td + edgeJ > pathW - 5) {
                                    color = pal.pathRim;
                                } else {
                                    color = pal.path[hash2(px, py, 61) < 0.55 ? 0 : 1];
                                    if (hash2(px, py, 62) < 0.015) {
                                        color = pal.pathRim;
                                    }
                                }
                            } else {
                                // Grass: banded shades + micro-variation + tufts/flowers.
                                const micro = hash2(px, py, 81);
                                const band = fbm(px * 0.006, py * 0.006, 71)
                                    + (micro - 0.5) * 0.08;
                                let bandIdx = 0;
                                if (band < 0.42) {
                                    bandIdx = 2;
                                } else if (band < 0.58) {
                                    bandIdx = 1;
                                }
                                const shade = pal.grass[bandIdx];
                                const m = (micro - 0.5) * 10;
                                color = [shade[0] + m, shade[1] + m, shade[2] + m];
                                const clus = fbm(px * 0.02, py * 0.02, 85);
                                // Flowers quantized to 4px cells → chunky blossoms in
                                // meadow clusters only, never uniform confetti.
                                const fq: [number, number] = [px >> 2, py >> 2];
                                if (micro > 0.94 && clus > 0.52) {
                                    color = pal.tuft;
                                } else if (
                                    clus > 0.66
                                    && hash2(fq[0], fq[1], 99) < pal.flowerDensity * 6
                                ) {
                                    // One species per ~64px patch so drifts read as beds.
                                    color = pal.flowers[
                                        (hash2(px >> 6, py >> 6, 100) * pal.flowers.length) | 0
                                    ];
                                } else if (hash2(px, py, 111) < 0.002) {
                                    color = pal.pebble;
                                }
                            }
                        }
                    }

                    for (let dy = 0; dy < BLOCK && by + dy < ch; dy++) {
                        let o = ((by + dy) * cw + bx) * 4;
                        for (let dx = 0; dx < BLOCK && bx + dx < cw; dx++) {
                            data[o] = color[0];
                            data[o + 1] = color[1];
                            data[o + 2] = color[2];
                            data[o + 3] = 255;
                            o += 4;
                        }
                    }
                }
            }

            ctx.putImageData(img, 0, 0);
            tex.refresh();
            scene.add.image(cx0, cy0, key).setOrigin(0, 0).setDepth(-10);
        }
    }
}

// ---------------------------------------------------------------------------
// Decoration scatter
// ---------------------------------------------------------------------------

export interface DecorSpot {
    key: string;
    /** World px, bottom-center anchor. */
    x: number;
    y: number;
    hTiles: number;
    flip: boolean;
    /** Flat ground decals render just above the ground, below every sprite. */
    flat: boolean;
    /** Hand-placed (authored sector) decor — legitimately spans water (bridges) and skips the
     * scatter clearance rules. Scatter items leave this unset. */
    authored?: boolean;
}

interface Family {
    keys: string[];
    h: [number, number];
}

interface RegionDecor {
    trees: Family;
    medium: Family[];
    small: Family[];
    decals?: Family;
}

function fam(prefix: string, ids: number[], h: [number, number]): Family {
    return { keys: ids.map((i) => `${prefix}-${String(i).padStart(2, "0")}`), h };
}

const DECOR: Record<number, RegionDecor> = {
    0: {
        trees: fam("foliage-sakura", [0, 1, 2, 3, 5, 8, 9], [2.6, 3.4]),
        medium: [
            fam("foliage-sakura", [11, 12, 13, 14, 22], [1.2, 1.6]),
            fam("foliage-sakura", [15, 16, 17, 18], [0.9, 1.3]),
            fam("foliage-sakura", [6, 7, 10], [1.8, 2.4]),
        ],
        small: [
            fam("foliage-sakura", [19, 21, 24, 25, 26, 27], [0.8, 1.1]),
            fam("prop-sakura-flowers", [0, 1, 2, 3, 4], [0.6, 0.8]),
        ],
        decals: fam("prop-sakura-petals", [0, 1], [0.5, 0.6]),
    },
    1: {
        trees: fam("foliage-keukenhof", [0, 1, 2, 3, 4, 5], [3.0, 3.6]),
        medium: [
            fam("foliage-keukenhof", [6, 7, 8, 9, 10, 11], [1.2, 1.5]),
            fam("foliage-keukenhof", [12, 13, 14, 15, 16, 17, 18], [0.9, 1.1]),
        ],
        small: [
            fam("foliage-keukenhof", [31, 32, 34, 35, 36, 37, 38], [0.6, 0.9]),
            fam("foliage-keukenhof", [20, 21, 22, 23], [0.8, 1.0]),
        ],
    },
    2: {
        trees: fam("foliage-versailles", [0, 1, 2, 3, 4, 5, 6], [2.2, 2.8]),
        medium: [
            fam("foliage-versailles", [10, 11, 12, 13, 14], [1.5, 1.9]),
            fam("foliage-versailles", [25, 26, 27, 28, 29, 30, 31], [1.1, 1.4]),
        ],
        small: [
            fam("foliage-versailles", [16, 17, 18, 19], [0.9, 1.1]),
        ],
    },
    3: {
        trees: fam("foliage-gardens-by-the-bay", [0, 2, 6, 21, 22], [2.8, 3.6]),
        medium: [
            fam("foliage-gardens-by-the-bay", [1, 3, 4, 8, 13, 15, 24], [1.5, 2.1]),
        ],
        small: [
            fam(
                "foliage-gardens-by-the-bay",
                [16, 18, 19, 25, 27, 28, 29, 30, 31, 32],
                [0.8, 1.2],
            ),
        ],
    },
};

/** Long tulip-field strips for the Keukenhof set piece. */
const TULIP_STRIPS = [4, 8, 11, 13, 15, 18].map(
    (i) => `prop-keukenhof-${String(i).padStart(2, "0")}`,
);

const VERSAILLES_HEDGE = "foliage-versailles-20";
const VERSAILLES_TOPIARY = [
    "foliage-versailles-00",
    "foliage-versailles-03",
    "foliage-versailles-10",
    "foliage-versailles-12",
];
const VERSAILLES_STATUES = [
    "prop-versailles-r0-02",
    "prop-versailles-r0-04",
    "prop-versailles-r0-10",
    "prop-versailles-r0-14",
];

function pick(family: Family, a: number, b: number, salt: number): { key: string; h: number } {
    const k = family.keys[(hash2(a, b, salt) * family.keys.length) | 0];
    const h = family.h[0] + hash2(a, b, salt + 1) * (family.h[1] - family.h[0]);
    return { key: k, h };
}

/** Emit authored decor + rectangular field fills for a region (docs/sectors/*). These are
 * hand-placed, so they skip the scatter clearance checks; the caller still blocks scatter
 * around them so ambient foliage never grows through a bridge or a tulip block. */
function authoredDecorFor(region: RegionPlan, exists: (key: string) => boolean): DecorSpot[] {
    const out: DecorSpot[] = [];
    for (const d of region.decor) {
        if (!exists(d.key)) {
            continue;
        }
        out.push({
            key: d.key,
            x: d.tileX * TILE + TILE / 2,
            y: d.tileY * TILE + TILE,
            hTiles: d.hTiles,
            flip: d.flip ?? false,
            flat: d.flat ?? false,
            authored: true,
        });
    }
    for (const f of region.fields) {
        const wTiles = Math.abs(f.x1 - f.x0) + 1;
        const hStrip = f.hTiles ?? Math.max(0.8, wTiles / 7);
        const step = f.rowStep ?? hStrip * 0.85;
        let row = 0;
        const midX = (f.x0 + f.x1) / 2 + 0.5;
        for (let y = Math.min(f.y0, f.y1); y <= Math.max(f.y0, f.y1) + 0.001; y += step) {
            const key = f.assets[row % f.assets.length];
            row++;
            if (!exists(key)) {
                continue;
            }
            out.push({
                key,
                x: midX * TILE,
                y: (y + 1) * TILE,
                hTiles: hStrip,
                flip: row % 2 === 0,
                flat: false,
                authored: true,
            });
        }
    }
    return out;
}

export function planDecor(
    plan: WorldPlan,
    model: TerrainModel,
    exists: (key: string) => boolean = hasAssetKey,
): DecorSpot[] {
    const { gw, gh, waterDT, trailDT } = model;
    const out: DecorSpot[] = [];

    const blockPts: Array<{ x: number; y: number; r: number }> = [];
    for (const r of plan.regions) {
        for (const p of r.plants) {
            blockPts.push({ x: p.tileX + 0.5, y: p.tileY + 0.5, r: 1.8 });
        }
        for (const p of r.props) {
            blockPts.push({ x: p.tileX + 0.5, y: p.tileY + 0.5, r: 3.2 });
        }
        blockPts.push({ x: r.waystone.tileX + 0.5, y: r.waystone.tileY + 0.5, r: 2.0 });
        for (const h of hedgeTilesForRegion(r.rect)) {
            blockPts.push({ x: h.tileX + 0.5, y: h.tileY + 0.5, r: 1.0 });
        }
        // Authored decor + field fills: emit them, and block ambient scatter around each.
        for (const d of authoredDecorFor(r, exists)) {
            out.push(d);
            if (!d.flat) {
                blockPts.push({ x: d.x / TILE, y: d.y / TILE, r: 1.4 });
            }
        }
        // Authored hedge tiles: render a clipped-hedge sprite on each (collision handled in
        // worldgen); block scatter so nothing grows through the parterre walls.
        if (r.authored && exists(r.hedgeKey)) {
            for (const h of r.hedges) {
                out.push({
                    key: r.hedgeKey,
                    x: h.tileX * TILE + TILE / 2,
                    y: h.tileY * TILE + TILE,
                    hTiles: 1.2,
                    flip: (h.tileX + h.tileY) % 2 === 0,
                    flat: false,
                    authored: true,
                });
                blockPts.push({ x: h.tileX + 0.5, y: h.tileY + 0.5, r: 0.9 });
            }
        }
    }
    for (const g of plan.gates) {
        blockPts.push({ x: g.tileX + 0.5, y: g.tileY + 0.5, r: 2.6 });
    }
    blockPts.push({ x: KEEPER_TILE.tileX + 0.5, y: KEEPER_TILE.tileY + 0.5, r: 3.5 });

    const clearAt = (tx: number, ty: number, size: number): boolean => {
        const px = tx * TILE;
        const py = ty * TILE;
        if (
            px < 8 || py < 8
            || px > plan.widthTiles * TILE - 8 || py > plan.heightTiles * TILE - 8
        ) {
            return false;
        }
        if (sampleDT(trailDT, gw, gh, px, py) < TILE * (0.75 + size * 0.18)) {
            return false;
        }
        if (sampleDT(waterDT, gw, gh, px, py) < TILE * (1.0 + size * 0.18)) {
            return false;
        }
        if (plazaField(px, py) < 1.18) {
            return false;
        }
        for (const b of blockPts) {
            const rr = b.r + size * 0.4;
            const dx = tx - b.x;
            const dy = ty - b.y;
            if (dx * dx + dy * dy < rr * rr) {
                return false;
            }
        }
        return true;
    };

    const placed: Array<{ x: number; y: number; r: number }> = [];
    const tryPlace = (
        tx: number,
        ty: number,
        family: Family,
        salt: number,
        flat = false,
        spacing = 0,
    ): void => {
        const { key, h } = pick(family, Math.round(tx * 7), Math.round(ty * 7), salt);
        if (!exists(key)) {
            return;
        }
        if (!clearAt(tx, ty, flat ? 0 : h)) {
            return;
        }
        const sp = spacing > 0 ? spacing : h * 0.45;
        for (const p of placed) {
            const dx = tx - p.x;
            const dy = ty - p.y;
            const rr = sp + p.r;
            if (dx * dx + dy * dy < rr * rr) {
                return;
            }
        }
        placed.push({ x: tx, y: ty, r: sp });
        out.push({
            key,
            x: tx * TILE,
            y: ty * TILE,
            hTiles: h,
            flip: hash2(Math.round(tx * 13), Math.round(ty * 13), salt + 5) < 0.5,
            flat,
        });
    };

    const regionAtTile = (tx: number, ty: number): number => {
        if (tx > SPLIT_X) {
            return ty > SPLIT_Y ? 3 : 1;
        }
        return ty > SPLIT_Y ? 2 : 0;
    };

    // A. Border forest bands — map edge + the seams between regions.
    for (let ty = 1; ty < plan.heightTiles - 1; ty++) {
        for (let tx = 1; tx < plan.widthTiles - 1; tx++) {
            const onEdge = tx < 4 || tx >= plan.widthTiles - 4
                || ty < 4 || ty >= plan.heightTiles - 4;
            const onSeam = Math.abs(tx - SPLIT_X) < 2.5 || Math.abs(ty - SPLIT_Y) < 2.5;
            if (!onEdge && !onSeam) {
                continue;
            }
            if (hash2(tx, ty, 201) > 0.34) {
                continue;
            }
            const jx = tx + (hash2(tx, ty, 202) - 0.5) * 1.6 + 0.5;
            const jy = ty + (hash2(tx, ty, 203) - 0.5) * 1.6 + 0.9;
            tryPlace(jx, jy, DECOR[regionAtTile(tx, ty)].trees, 210);
        }
    }

    // B. Interior scatter per region — medium clumps then small fillers, clustered by species.
    for (const r of plan.regions) {
        const reg = REGION_INDEX[r.section];
        const decor = DECOR[reg];
        for (let ty = r.rect.y + 2; ty < r.rect.y + r.rect.h - 1; ty += 3) {
            for (let tx = r.rect.x + 2; tx < r.rect.x + r.rect.w - 1; tx += 3) {
                if (hash2(tx, ty, 301) > 0.5) {
                    continue;
                }
                const clus = fbm(tx * 0.11, ty * 0.11, 305);
                // Dense cluster cores grow full trees; the rest get bushes/flowers.
                const family = clus > 0.64 && hash2(tx, ty, 306) < 0.65
                    ? decor.trees
                    : decor.medium[(clus * decor.medium.length) | 0] ?? decor.medium[0];
                const jx = tx + (hash2(tx, ty, 302) - 0.5) * 2.4 + 0.5;
                const jy = ty + (hash2(tx, ty, 303) - 0.5) * 2.4 + 0.5;
                tryPlace(jx, jy, family, 310);
            }
        }
        for (let ty = r.rect.y + 1; ty < r.rect.y + r.rect.h - 1; ty += 2) {
            for (let tx = r.rect.x + 1; tx < r.rect.x + r.rect.w - 1; tx += 2) {
                if (hash2(tx, ty, 401) > 0.3) {
                    continue;
                }
                const clus = fbm(tx * 0.13, ty * 0.13, 405);
                const family = decor.small[(clus * decor.small.length) | 0]
                    ?? decor.small[0];
                const jx = tx + (hash2(tx, ty, 402) - 0.5) * 1.8 + 0.5;
                const jy = ty + (hash2(tx, ty, 403) - 0.5) * 1.8 + 0.5;
                tryPlace(jx, jy, family, 410);
            }
        }
        if (decor.decals) {
            for (let ty = r.rect.y + 2; ty < r.rect.y + r.rect.h - 2; ty += 3) {
                for (let tx = r.rect.x + 2; tx < r.rect.x + r.rect.w - 2; tx += 3) {
                    if (hash2(tx, ty, 501) > 0.22) {
                        continue;
                    }
                    const jx = tx + (hash2(tx, ty, 502) - 0.5) * 2 + 0.5;
                    const jy = ty + (hash2(tx, ty, 503) - 0.5) * 2 + 0.5;
                    tryPlace(jx, jy, decor.decals, 510, true, 1.2);
                }
            }
        }
    }

    // C. Set pieces.
    setPieces(plan, model, exists, out);

    return out;
}

function setPieces(
    plan: WorldPlan,
    model: TerrainModel,
    exists: (key: string) => boolean,
    out: DecorSpot[],
): void {
    const { gw, gh, waterDT, trailDT } = model;

    // In the compact world, set pieces share the scatter's clearance rules so they never
    // land on water or on a plant bed.
    const plantPts = plan.regions.flatMap((r) => r.plants);
    const okStanding = (px: number, py: number): boolean => {
        if (sampleDT(waterDT, gw, gh, px, py) < TILE * 1.0) {
            return false;
        }
        for (const p of plantPts) {
            const dx = px / TILE - (p.tileX + 0.5);
            const dy = py / TILE - (p.tileY + 0.5);
            if (dx * dx + dy * dy < 1.6 * 1.6) {
                return false;
            }
        }
        return true;
    };

    // Keukenhof: rectangular tulip-field patches (the signature look). Skipped for authored
    // regions — those place their tulip ribbons via `fields` (authoredDecorFor).
    const bb = plan.regions.find((r) => r.section === "B-B" && !r.authored);
    if (bb && TULIP_STRIPS.some(exists)) {
        const br = bb.rect;
        // Two tulip-field patches inside the (compact) Keukenhof rect.
        const patches = [
            { x0: br.x + 8, x1: br.x + 18, y0: br.y + 2, y1: br.y + 7 },
            { x0: br.x + 12, x1: br.x + 22, y0: br.y + 10, y1: br.y + 15 },
        ];
        let rowIdx = 0;
        for (const p of patches) {
            const midX = (p.x0 + p.x1) / 2;
            const wTiles = p.x1 - p.x0;
            const hStrip = wTiles / 6.9;
            for (let y = p.y0 + hStrip; y <= p.y1; y += hStrip * 0.85) {
                const key = TULIP_STRIPS[rowIdx % TULIP_STRIPS.length];
                rowIdx++;
                if (!exists(key)) {
                    continue;
                }
                let blocked = false;
                for (let sx = 0; sx <= 4; sx++) {
                    const px = (p.x0 + (sx / 4) * wTiles) * TILE;
                    const py = y * TILE;
                    if (
                        sampleDT(waterDT, gw, gh, px, py) < TILE * 1.2
                        || sampleDT(trailDT, gw, gh, px, py) < TILE * 0.9
                    ) {
                        blocked = true;
                        break;
                    }
                }
                if (blocked || !okStanding(midX * TILE, y * TILE)) {
                    continue;
                }
                out.push({
                    key,
                    x: midX * TILE,
                    y: y * TILE,
                    hTiles: hStrip,
                    flip: rowIdx % 2 === 0,
                    flat: false,
                });
            }
        }
    }

    // Versailles: render the (already-solid) hedge rows + formal topiary + statues. Skipped for
    // authored regions (they place their own parterre via props/decor/fields).
    const cp = plan.regions.find((r) => r.section === "C-P" && !r.authored);
    if (cp) {
        if (exists(VERSAILLES_HEDGE)) {
            const rows = new Set(hedgeTilesForRegion(cp.rect).map((t) => t.tileY));
            for (const ty of rows) {
                for (let tx = cp.rect.x + 3; tx < cp.rect.x + cp.rect.w - 3; tx += 2.6) {
                    if (!okStanding(tx * TILE, (ty + 1.1) * TILE)) {
                        continue;
                    }
                    out.push({
                        key: VERSAILLES_HEDGE,
                        x: tx * TILE,
                        y: (ty + 1.1) * TILE,
                        hTiles: 1.35,
                        flip: Math.round(tx) % 2 === 0,
                        flat: false,
                    });
                }
            }
        }
        const cx = cp.rect.x + Math.floor(cp.rect.w / 2);
        const cy = cp.rect.y + Math.floor(cp.rect.h / 2);
        for (let i = 0; i < VERSAILLES_TOPIARY.length * 3; i++) {
            const key = VERSAILLES_TOPIARY[i % VERSAILLES_TOPIARY.length];
            if (!exists(key)) {
                continue;
            }
            const along = cp.rect.x + 6 + i * 4.2;
            if (along > cp.rect.x + cp.rect.w - 6) {
                break;
            }
            for (const side of [-2.2, 2.2]) {
                if (!okStanding(along * TILE, (cy + side + 0.5) * TILE)) {
                    continue;
                }
                out.push({
                    key,
                    x: along * TILE,
                    y: (cy + side + 0.5) * TILE,
                    hTiles: 2.1,
                    flip: side > 0,
                    flat: false,
                });
            }
        }
        let sIdx = 0;
        for (const key of VERSAILLES_STATUES) {
            if (!exists(key)) {
                continue;
            }
            const ty = cp.rect.y + 6 + sIdx * 4;
            sIdx++;
            if (ty > cp.rect.y + cp.rect.h - 5) {
                break;
            }
            for (const side of [-2.4, 2.4]) {
                if (!okStanding((cx + side) * TILE, ty * TILE)) {
                    continue;
                }
                out.push({
                    key,
                    x: (cx + side) * TILE,
                    y: ty * TILE,
                    hTiles: 1.8,
                    flip: side > 0,
                    flat: false,
                });
            }
        }
    }
}
